# Waves 5 and 6 build contract: wins and cash, one LTV writer, the agent login, the bank receipt, Reactivate, the retire list, Stage 4

Written 2026-11-02 (Kuwait, the day waves 3 and 4 went live) for branch `forms-w56` in two repos:

- **cockpits:** worktree `/Users/abdulazizwaheedi/mahara-worktrees/forms-w56`, branch `forms-w56` at
  origin/main `b4db4eb8` (waves 3 and 4 merged, PR #135 and #136; migrations `20261102a` to `f` live).
- **portal (Mahara OS):** worktree `/Users/abdulazizwaheedi/mahara-worktrees/portal-w34`, branch
  `forms-w56` cut from origin/main `b42a4ca` (live source `584008c`, deployment
  `dpl_4hbWktGsdZWswCBjvx3yMghnpPgi`, v1.6.0; `node_modules` installed). Never
  `/Users/abdulazizwaheedi/mahara-worktrees/client-portal` (another session's worktree).

It builds waves 5 and 6 of `docs/forms/CSM-CLIENT-FORMS-PLAN.md` ("the plan": E1 to E20, 4.2 WL, AG,
sections 5.3, 5.4, 5.6, 5.7, 5.12, 5.16, 5.17, 5.19, 5.20, section 6 waves 5 and 6). The plan's
section 7 defaults are approved (Q1 to Q23, Q11b and Q21 included). It is modelled on
`docs/forms/WAVE34-CONTRACT.md` ("W34") and `docs/forms/WAVE12-CONTRACT.md` ("W12") and keeps their
habits: every claim about live state carries the query behind it (11.2, read only, 2026-11-02),
every replaced function is guarded against drift, every new writer is dark at deploy and has one
named way to turn on.

**The CEO's words** (quote, do not reinterpret), 2026-11-01: "now the rest of the plan and forms,
make them amazing and get them fully done". Earlier the same day: "log the chured clients and mark
them in the cockpit and clickup even if they havent finished the form and calls", and on 2026-09-21:
"every attributed payment adds to the client's LTV table and the ClickUp LTV field". On 2026-11-02,
on the Stage 4 parity differences (11.8): "Yes, match Make" (X37, 11.9). This contract
decides every builder question with the safest default and records it (11.1, decisions X1 onward).
Builders never ask; they follow this file, and where code and this file disagree they stop and leave
a note in their slice's report.

**Hard rules for every builder.** No push, no deploy, no migration applied, no write to the live
database, ClickUp, Make, Typeform, Slack, WhatsApp, GoHighLevel, GitHub or the VPS. Read the live
database only with SELECT through
`/private/tmp/claude-501/-Users-abdulazizwaheedi-mahara-cockpits/0c703d57-23fd-4455-a499-4821613deb77/scratchpad/sq "select ..."`.
Never touch `/Users/abdulazizwaheedi/mahara-cockpits` (shared checkout) or
`/Users/abdulazizwaheedi/mahara-worktrees/client-portal`. Never print a secret. Repo `CLAUDE.md` rules
hold (Supabase first; row security and its grant in the same migration; every action gated on the
server with an audit row; external calls through the existing helpers so they land in the health
ledger; missing is never zero; numbers checked against a second source with a note). A view that the
VPS sync or the CEO refresh reads needs every helper function it calls executable by
`supabase_read_only_user` (lesson of `20261101r`). Before any screen: load
`/Users/abdulazizwaheedi/mahara-context/skills/frontend-design/SKILL.md` and Hallmark
(`~/.cache/mahara-ship/skills/hallmark/SKILL.md`), follow the design plan in section 5, then code.
Arabic lines are written under `/Users/abdulazizwaheedi/mahara-context/skills/aziz-kuwaiti-voice/SKILL.md`
(section 5 gives every one; a builder who needs a new one drafts it under that skill and lists it in
the slice report). Client copy never quotes leads or cost per lead and never promises results.
`scripts/check-shared.sh` pairs stay identical. Portal: read `AGENTS.md`, `docs/CURRENT-STATE.md`,
`VERSION.json` first and the relevant guide in `node_modules/next/dist/docs/` before writing Next code
(Next 16). Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Disk is nearly full (about 2 GB free).** Never run `npm ci`, `bun install` or
`prepare-worktree --apply` in a new worktree. After `git worktree add`, symlink the base's installed
packages instead: for the cockpits, every `node_modules` directory under
`/Users/abdulazizwaheedi/mahara-worktrees/forms-w56` (root, `apps/*/`, and any `supabase/functions/*`
or `hermes/*` that has one) becomes the same path in the new worktree as a symlink to the base's
directory; for the portal, `ln -s /Users/abdulazizwaheedi/mahara-worktrees/portal-w34/node_modules
<worktree>/node_modules`. Remove build outputs (`dist`, `.next`) when done.

---

## 0. The shape in fifteen lines

1. **Four cockpit migrations, `20261102g` to `20261102j`**, one per SQL slice; live holds `20261102a` to `f` and no branch or worktree holds a later `20261102` or any `20261103` file (11.2-a, b). The portal gets **no database migration**.
2. **The money rails** (`g`): billing kinds `win` (card comment only) and `reactivate` (card writes), the daily **LTV writer** (E10: card baseline plus *checked* tied money, the same sum `ltv.preview` shows, now written every morning through billing kind `ltv`), **Confirm paid moves the next payment date** (5.4, one date write per save), three notice kinds, and **the billing agent's own login** (AG): a key only its sha256 is stored, an Edge Function door, and two service-only SQL functions, so the agent writes only through its door. It stops holding the master key only where the VPS can keep every Supabase key out of its runtime's reach (D-AG0); where it cannot, the contract says so plainly and AG is recorded as not achieved (X27).
3. **The wins ledger** (`h`, WL): `cockpit_csm_wins` records reviews, video testimonials, podcasts, referrals, renewals, reactivations and five kinds of upsell, each with its proof; "Log a win" on the client page and the Money tab; the dead review link in `ClientAsks.tsx` becomes "Log it".
4. **Upsell stages**: Offered (`quote_given`, a *sent* proposal or a proof link) → Accepted (`signed`, an agreement) → Paid (a CEO-confirmed tie of a checked payment) or void. A draft never becomes a win.
5. **The back-end rule for `win_id` ties** (Q23): a payment tied to a win is always the card CSM's back-end money, never the closer's, never in the deal ledger or a deal's contract total; one payment ties to one win at most, so upsell cash is counted once (both attribution copies and their parity test).
6. **Pay proposals** (E12): the cockpit proposes pay lines from the ledger (review $75, video $150, podcast $250, referral $250 once the referred deal pays, renewal and reactivation $300, upsell 10% of tied cash, recurring 20% then 5%); the CEO confirms each with one press into `cockpit_pay_entries`; nothing pays itself. **C7**: the five Four Rs Typeforms and Make scenarios go off, and a typed pay entry for a win-backed part needs a `win:` reference or a stated reason.
7. **One LTV writer, C8**: the CEO Money tab's "Apply" (`ceo.ltv.apply`) is retired and the billing agent's `log_payment.py` LTV write is removed, both inside D-LTV before the morning writer turns on (X25); the portal's LTV sync is retired in code; Make writes no LTV (11.2-l); the Google Sheet "Payments" tab is frozen (D-AG).
8. **The bank receipt** (`i`, 5.17): a client form (portal or link) asking for the transfer receipt, sent from a Pending payments part or from a logged, unchecked transfer in Checks waiting; the receipt lands in the checks list and is never cash, LTV or pay until finance or the CEO checks it. It brings the private bucket `cockpit-form-files` and the `file` and `date` field types.
9. **Reactivate** (`i`): a churned client returning is one audited act on the client page that reopens the card through the rails (status back, churn fields cleared, a comment with the old churn), marks the departure `returned` without uncounting the month it left, and logs one reactivation win per return (its pay waits for proof).
10. **The C9 retire list** (11.3 and table `cockpit_retire_items`): every remaining Make scenario and Typeform the CSM work used, each with its owner role, replacement, switch-off step and the **14-quiet-days archive rule** (archive only what is already off and has had no run and no old-link answer for 14 days; never delete).
11. **Stage 4** (`j`): the **kickoff** (`tG7dnxBn`) becomes a native staff form in the CSM cockpit and the **client onboarding** (`KFRCXPFx`) a native client form in the portal renderer; every Make effect of `8925654` and `8922994` is ported and proven equal on recorded inputs and on the test card before its scenario goes off in the same hour; the kickoff carries the **New MRR** question (Q21). The onboarding Typeform stays open as a second door into the same native planner until Make `8979157` [40] can carry a native invite (X26). Since the CEO's "Yes, match Make" (X37), the native outputs equal what Make writes for the same answers, byte for byte where Make writes text (`20261102m`, 2.9); what cannot match is said in 11.9.
12. **Every new writer is dark at deploy** (1.4): door markers false, kinds out of the billing switch, settings off, forms out of the live list.
13. **Six build slices** with disjoint files (section 7): five in the cockpits, one in the portal; three start at once.
14. **Deploy** (section 9): migrations through Composio with read-backs and md5 guards; functions with `--verify-jwt` matching live; cockpits by `scripts/ship.sh`; the portal by the Mac release steps; VPS code by native release, file-scoped; Make and Typeform switch-offs each backed up and read back; canaries only on the internal test card `86eywg1cq`; the kickoff and onboarding go live only after parity of every Make effect is proven.
15. **What waits on people** (section 10): Q4 (the #nps-survey-feedback bot invite, still open from wave 4), the finance seat (none exists, so checks route to the CEO), the first real presses and answers (watched, never faked), and the CEO's Arabic edits.

---

## 1. Scope

### 1.1 In waves 5 and 6

| Piece | Plan ref | Slice | Live at deploy |
|---|---|---|---|
| Notice kinds `win.logged`, `receipt.in`, `client.reactivated` | 5.6, 5.7, 5.17 | money-rails | all three seeded `enabled = false` |
| Billing kinds `win` (comment) and `reactivate` (writes and comment); canary for `ltv`, `win`, `reactivate`, `date` | 3.1 | money-rails | held: neither kind in `CLICKUP_WRITEBACK_BILLING_KINDS` |
| One LTV writer: the daily step, the CEO read and the held-jump release; `ceo.ltv.apply` refused | E10, 5.3 | money-rails | `billing.ltv.on = false`, kind `ltv` not in the billing switch |
| Confirm paid moves the next payment date (and its withdraw undoes it) | 5.4 | money-rails | `billing.confirm_date.on = false` |
| AG: agent keys, the `billing-agent` Edge Function, `cockpit_billing_agent_write` / `_read`, the Python client | 4.2 AG, E17 | money-rails | no key exists, so the door refuses everything |
| WL: wins ledger, win events, tie proposals, `cockpit_payment_ties.win_id`, `cockpit_invoices.win_id`, registry row `win` | 4.2 WL, 5.6, 5.7 | wins-pay (SQL, readers), cockpit-screens (screens) | door `wins` hidden (marker false) |
| Upsell stages and the back-end rule for `win_id` ties (native `money.js`, Edge `attribution.ts`, parity test, MONEY-ATTRIBUTION rule 7) | 5.6, Q23 | wins-pay | the rule is live with the next refresh; no tie with a `win_id` can exist until D-W |
| Pay proposals and the CEO's confirm; C7 rule on typed entries; wins metrics, SOURCES rows | E12, 5.7 | wins-pay (SQL, readers), cockpit-screens (CEO pay card) | `pay.proposals.on = false` |
| C7 switch-offs (five Typeforms, five webhooks, phoenix, five Make scenarios), 35 old wins imported as void | 5.7 | deploy (D-W); `wins_backfill.py` by wins-pay | Typeform and Make untouched until D-W |
| Bank receipt client form, file and date field types, bucket, file slots, receipts table, inbox source `portal` | 5.17, F1 | client-tail (SQL, staff file door), portal-56 (renderer, uploads), cockpit-screens (Ask buttons) | `bank_receipt` not in `forms.client.live` |
| Reactivate (lifecycle confirm `reactivate`, departure `returned_on`, prefill, registry row) | wave 6 | client-tail (SQL), cockpit-screens (sheet) | door `reactivate` hidden; kind held |
| C9 retire registry `cockpit_retire_items` with its seed (11.3); guardian `retire-quiet` | 5.20, E19 | client-tail | data only; switch-offs are deploy steps |
| Guardian checks for every piece, runbook rows | 8 | client-tail | report-only; "not set up yet" reads ok |
| Stage 4 kickoff native (staff form, prefill, submit, every Make 12 effect, New MRR, read model) | 5.12, Q21 | stage4 (SQL, workers), cockpit-screens (the kickoff sheet) | `forms.stage4.kickoff = false`; the Typeform keeps working |
| Stage 4 onboarding native (client form, portal page, every Make 13 effect, read model, gate evidence) | 5.16 | stage4 (SQL, workers), portal-56 (page) | `forms.stage4.onboarding = false`; the Typeform embed keeps working |
| Client message kinds `phase3`, `phase4` (their texts end with the client's content folder link, put in at send, X35); the relay worker for the GitHub dispatch (no Client Data write, X34); parity script (rebuilt on stored answers, X36); Make's texts and choices built in SQL, the five kickoff follow-ups, the handoff as a comment on each onboarding task, and phase drafts approvable in `cockpit-forms-api` (X37, `20261102m`) | 5.12, 5.16 | stage4; D-S4.0 and D-S4F fixes on `forms-s4-fixes` | `CLIENT_MESSAGES_KINDS` unchanged; `FORMS_RELAY_APPLY=false`; `onboarding.raw_titles` `{}` until D-S4F |
| Portal LTV sync retired in code | E10, E16 | portal-56 | it was off by env; now it cannot run |
| Links repointed (Four Rs, kickoff, onboarding, media buyer old kickoff) | 5.7, 5.20 | cockpit-screens | live on ship, each row follows its door flag |

### 1.2 Not in waves 5 and 6

- The "Reactivate your ads" client form (5.18, Typeform `ecJQ5Z5C`): not built (X13). Its links were removed in wave 0, it has no webhook, nothing reads it, and `hermes/ad-billing-guard` stays the decider; the Typeform is closed in C9.
- The New Client Form (`BTzMwXiw`) is not changed: Make 8979157, Cortana, HighLevel and B2B `typeform-sync` read it and a submission must never be imitated (memory new-client-form). The New MRR question goes on the native kickoff (X16).
- Replacing the Client Data Google Sheet (`cockpit_client_groups`): later. Stage 4 writes nothing to it, as Make never did (D-S4.0, X34); the client-messages worker keeps reading the card's row for the group (column F) and the content folder (column H, X35).
- NPS and CSAT go-live (W34 D-C5): still waits on Q4; not re-planned here, only listed in the retire table.
- The portal's own billing ledger (E16) stays off; its LTV sync is retired.
- Staff file uploads (a review screenshot from the CSM): proof is a link in v1 (X7).
- The 55 held ClickUp edits of other kinds (Q19): untouched.
- The kickoff and Blueprint client recaps (Q22): stay off (the kickoff's `recap` effect stays `shadow` in version 2, 4.15).
- Make `8979157` [40] (the Arabic welcome) keeps its onboarding Typeform link; sending a native onboarding invite at signing needs form invites on WhatsApp (`form_invite` in `CLIENT_MESSAGES_KINDS`, with the CSM's approval) and is a later step (X26, section 10).

### 1.3 What only people can do (never faked)

| Item | Who |
|---|---|
| Invite the Slack bot to #nps-survey-feedback (Q4, carried from wave 4) | the CEO |
| A finance seat: none exists (11.2-n), so receipt checks and `payment_receipt_check` route to the CEO | the CEO adds the role when he hires or names one |
| A CSM's first real Log a win, Mark as offered, Accepted, tie proposal, Reactivate and kickoff; a client's first real receipt and native onboarding answer | the CSM and clients; watched after each go-live |
| The CEO's first confirm of a pay proposal and of a win tie | the CEO |
| Arabic wording changes to anything in section 5 | the CEO (client forms through the forms editor; the session's drafts are used as is until then) |
| A look at the native onboarding's drafted other-language questions in the forms editor before D-S4O (4.14.1) | the CEO |
| An internal WhatsApp group (team members only) for the test card `86eywg1cq` and its Client Data row, with a content folder link in column H (Google Drive Link), before D-S4K (D-S4.0 ran without it), so phase 3 and phase 4 are proven sent end to end | the CEO or the systems manager |
| A separate Unix user (or runtime) for the billing agent on the VPS, if D-AG0 finds the agent can read a file holding a Supabase key that other workers need | the systems manager |

### 1.4 The switches (every new writer, its switch and its state at deploy)

| Writer | Switch | Where | At deploy | Turned on |
|---|---|---|---|---|
| Log a win, win stages, tie proposals, invoice link | `cockpit_form_doors().wins` = functions exist **and** `forms.doors.wins` marker | database | marker `false` | D-W |
| Win card comment | kind `win` in `CLICKUP_WRITEBACK_BILLING_KINDS` | Edge secrets `clickup-writeback` | absent (items `dry_run`) | D-W, canary on the test card first |
| `win.logged` notice (#csm-announcements) | its settings row `enabled` | database | `false` | D-W, in the hour the five Four Rs scenarios go off (they post there today) |
| Pay proposals and the C7 entry rule | `pay.proposals` `{"on":bool}` | database | `{"on":false}` | D-W |
| LTV daily writer | `billing.ltv` `{"on":bool,"maxDeltaUsd":5000}` **and** kind `ltv` in the billing switch | database + Edge secrets | `on:false`; `ltv` absent | D-LTV |
| `ceo.ltv.apply` refusal | the deployed `cockpit-media-api` | Edge | the old apply still works until D-LTV deploys the refusal, so one writer exists at every moment | D-LTV |
| The Money tab Apply (screen) | `cockpit_form_doors().ltv` | database | shown while the flag is false; replaced by the Lifetime value card when it is true (5.5) | D-LTV |
| The billing agent's `log_payment.py` LTV write | the live skill file on the VPS | VPS | still writes until D-LTV deletes it (backed up, read back) before `billing.ltv.on=true` | D-LTV (deleted) |
| Confirm paid moves the date | `billing.confirm_date` `{"on":bool,"windowDays":7}` | database | `on:false` | D-CD |
| Agent door | a row in `cockpit_agent_keys` | database | none (every call refused `This key is not known.`) | D-AG |
| Bank receipt invites, file slots | `bank_receipt` in `forms.client.live` (W34's go-live list) | database | absent | D-BR |
| `receipt.in` notice (#csm-general) | settings row | database | `false` | D-BR |
| Reactivate | `cockpit_form_doors().reactivate` **and** kind `reactivate` in the billing switch | database + Edge secrets | marker `false`; kind absent | D-RA |
| `client.reactivated` notice | settings row | database | `false` | D-RA |
| Kickoff native (sheet, submit, effects) | `forms.stage4` `{"kickoff":bool,"onboarding":bool}`, `CLICKUP_WRITEBACK_FORMS_KEYS` lists `kickoff`, `CLIENT_MESSAGES_KINDS` lists `phase4`, `FORMS_RELAY_APPLY=true` | database, Edge secrets, VPS files | `kickoff:false`; FORMS_KEYS `checkin`; kinds unchanged; relay `false` | D-S4K |
| Onboarding native (portal page, effects) | `forms.stage4.onboarding` **and** `onboarding` in `forms.client.live`; FORMS_KEYS lists `onboarding`; `phase3` in client-messages kinds | database, Edge secrets, VPS | off | D-S4O |
| Door markers `agent`, `ltv` (CEO cards) | `forms.doors` markers | database | `false` | D-AG, D-LTV |
| `cockpit_form_doors()` flags `kickoff` | functions exist **and** `forms.stage4.kickoff` | database | false | D-S4K |

---

## 2. The migrations

### 2.1 Names and order

The live database holds `20261101a` (two files) to `r` and `20261102a` to `f` (11.2-a). No branch,
remote or worktree holds a `20261102g` or later file, or any `20261103` file (11.2-b). Waves 5 and 6
take `20261102g` to `j`:

| Order | File | Slice | Holds |
|---|---|---|---|
| 1 | `supabase/migrations/20261102g_money_rails_w5.sql` | money-rails | notice kinds, billing kinds `win` and `reactivate`, LTV writer, Confirm paid date, agent keys and door functions, `cockpit_form_doors` |
| 2 | `supabase/migrations/20261102h_wins_pay.sql` | wins-pay | wins ledger, tie proposals, `win_id` columns, registry row `win`, pay proposals, the C7 entry rule, `cockpit_wins_v` |
| 3 | `supabase/migrations/20261102i_client_tail.sql` | client-tail | file and date field types, bucket, file slots, bank receipt, receipts, Reactivate, retire registry, `cockpit_form_card_allows` |
| 4 | `supabase/migrations/20261102j_stage4_native.sql` | stage4 | kickoff and onboarding native, option maps, phase kinds, system requests, relay outbox, parity plan, stage 4 go-live |
| 5 | `supabase/migrations/20261102l_stage4_no_client_data_row.sql` | D-S4.0 fixes (branch `forms-s4-fixes`) | `client_data_row` out of the onboarding arrays, the plan builder and the relay outbox (2.8, X34); `20261102k` was already taken by a pay correction outside the forms program |
| 6 | `supabase/migrations/20261102m_stage4_match_make.sql` | D-S4F fixes (branch `forms-s4-fixes`) | Make 12's and Make 13's texts and choices built in SQL, the five kickoff follow-ups, the handoff carried whole to each onboarding task's comment, `onboarding.raw_titles` (2.9, X37). Live and every branch were free of `m` on 2026-11-02, but the worktree `goals-sheet` holds an untracked `20261102m_goal_sheet_truth.sql` (11.2-v): D-S4F's letter rule settles which file moves |

**The letter rule.** Before builders start and again before every apply, the orchestrator reads
`select name from supabase_migrations.schema_migrations where name like '20261102%' or name like '20261103%'`,
`git ls-tree --name-only origin/main supabase/migrations/` and every branch and worktree. If any of
`g` to `j` is taken, the whole block moves to the next free consecutive letters, same order, and this
table is amended before builders start. Builders never rename a file. Tests name files by full stem.

**Every file**: starts `BEGIN;`, ends `NOTIFY pgrst, 'reload schema'; COMMIT;`, applies twice without
error, uses `LANGUAGE plpgsql` for any function that names an object of a later file, and writes
`CREATE OR REPLACE` / `IF NOT EXISTS` / guarded CHECK swaps (`pg_get_constraintdef ... NOT LIKE`, as
`20261029t` does). Settings seeds merge, never overwrite: existing keys win, so the seed is the left
side, `SET value = excluded.value || public.cockpit_settings.value ... WHERE NOT (public.cockpit_settings.value ?& array[<the seeded keys>])`
(jsonb `||` lets the right side win). A re-apply after a go-live therefore never switches a door,
`billing.ltv.on` or `billing.confirm_date.on` back off; each file's PGlite test applies the file,
sets `forms.doors.wins` (or the file's own marker) true, applies again and asserts it is still true.
The house pattern `cockpit_settings.value || '<seed>' WHERE NOT value @> '<seed>'` (20261102d) is
only safe for a seed of `true` values and is not used for any `false` seed here.

**Row security and grants** (W12 2.1, unchanged). Every new table: `ENABLE ROW LEVEL SECURITY`;
`REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role`; `GRANT` service_role exactly what it
needs; no browser grant; browser access only through `SECURITY DEFINER ... SET search_path = ''`
functions whose first line is the gate; an audit trigger into `cockpit_audit_log` (through
`cockpit_forms_audit()` where the table is a forms table); delete and truncate refused on wins, win
events, tie proposals, pay proposal decisions, file slots, receipts, agent keys, agent calls and the
retire registry (`cockpit_forms_refuse_delete()`). Every new view: `WITH (security_invoker = true)`,
revoked from PUBLIC, anon and authenticated, `GRANT SELECT` to service_role and, when the CEO refresh
or the VPS reads it, `GRANT SELECT` to `supabase_read_only_user` plus `GRANT EXECUTE` to that role on
every function it calls. Every new or replaced function is revoked from all four roles first and
granted exactly as section 3 says.

**The drift guard.** Each file that replaces a live function opens, right after `BEGIN;`, with one
`DO` block that reads `md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))` for every function it replaces
(2.2) and raises `55000` `<function> changed since the waves 5-6 contract read it; stop and re-read it.`
unless the value is the live md5 below or the file's own "after" value (written into the file by its
builder, asserted by the slice's PGlite test). The view `cockpit_client_lifecycle_v` is guarded the
same way on `md5(regexp_replace(pg_get_viewdef(...), '\s+', ' ', 'g'))`. Before each apply the
deploy saves `pg_get_functiondef` of each to
`/Users/abdulazizwaheedi/mahara-cockpits/notes/forms-w56/deploy/before-<name>.sql`.

### 2.2 Functions replaced (one owner each; live body md5 read 2026-11-02, 11.2-c)

| Function | Live body md5 | Live ACL | Replaced by | Change |
|---|---|---|---|---|
| `cockpit_slack_notice_shape(text)` | `65bee7a75bc943031bf3d71beaf9bd7c` | owner | `g` | three kinds, all `post` |
| `cockpit_slack_notice_kind_label(text)` | `75d4d7515419d0a968d092b44d416dbb` | owner | `g` | three labels (3.9) |
| `cockpit_slack_notice_live(cockpit_slack_notices)` | `eecd54cfe2ea8411174d16cb479ad261` | owner | `g` | live rules for three kinds |
| `cockpit_slack_notice_inputs(jsonb)` | `d665b505014dc61c4d71ff59126dc90e` | service_role | `g` | kind list |
| `cockpit_slack_notice_doctor_inputs()` | `a7c6a68324e3d601156e0f13f5f9e513` | service_role | `g` | order list |
| `cockpit_slack_notice_settings_read()` | `29bb5362cd8426cec51ff24fb6178c58` | authenticated | `g` | order list |
| `cockpit_slack_notice_settings_set(text,jsonb)` | `60751ee78283238fc89d33bb76b050df` | authenticated | `g` | kind list |
| `cockpit_slack_channel_remove(text)` | `f9e0c0f36bd2d8450e90e8aece898926` | authenticated | `g` | order list |
| `cockpit_slack_notice_rehearse(text)` | `2ea83a6770947fce31d587f214d16817` | authenticated | `g` | kind list |
| `cockpit_slack_notice_rehearse_service(text,text)` | `044ba3be2c44da6d6ebe8fa73f20d5d8` | service_role | `g` | kind list |
| `cockpit_slack_notice_read(text)` | `56e3035431a069a6f4d2f74b3425a267` | authenticated | `g` | the new kinds visible to csm, finance and CEO seats |
| `cockpit_billing_writeback_writes(text,text,text,jsonb)` | `547e7750bfaf4473c50365bcbdcf8dac` | owner | `g` | cases `win` (none) and `reactivate` (3.3) |
| `cockpit_billing_writeback_comment(text,text,text,jsonb,text)` | `850a7430b7b8cfc62a170ecccf127d63` | owner | `g` | comments `win`, `reactivate`; `date` comment names a confirm; `mrr` labels the system reason categories `new_client` (New client) and `reactivation` (Reactivation) (3.5) |
| `cockpit_billing_detail(text,jsonb)` | `6b483cc5047953d545123e00cb87cb07` | owner | `g` | details for `win`, `reactivate`, `date` from a confirm; the two `mrr` reason labels |
| `cockpit_billing_canary(text,jsonb)` | `066b53ffb9b4a8be423ee464e4d897c5` | owner | `g` | kinds `ltv`, `win`, `reactivate`, `date` on `86eywg1cq` only |
| `cockpit_billing_daily_run(date)` | `1c4087aa6bd3fda9ef35a5b8360fc38c` | owner | `g` | the LTV step after the late records (4.4); everything else byte for byte |
| `cockpit_billing_balance_write(text,jsonb)` | `fb245e7e7c292a68f07b91e8cb2aaa79` | authenticated | `g` | `confirm` and `withdraw` queue the date move (4.6) |
| `cockpit_billing_balances_read()` | `cfd508625131949f69ca153ef457e2d3` | authenticated | `g` | each part gains `dateIfConfirmed` |
| `cockpit_form_doors()` | `2991d3cbadd1003f4f85d0a91de10af2` | authenticated | `g` | flags `wins`, `receipts`, `reactivate`, `kickoff`, `agent`, `ltv` (3.10) |
| `cockpit_ceo_pay_entry_save(jsonb)` | `48ff70e02b66ffefc858342146b41998` | authenticated | `h` | the C7 rule (4.9); everything else byte for byte |
| `cockpit_ceo_payment_tie(jsonb)` | `b46f90ce93bbf07f35614de78805534d` | authenticated | `h` | refuses when the live row of the same scope has a `win_id` (`This payment is tied to a win. Clear it from the win.`); everything else byte for byte |
| `cockpit_ceo_payment_untie(jsonb)` | `e569f8c08d8260b4cdbc4a237c1c51c9` | authenticated | `h` | refuses a row with a `win_id` with the same sentence; everything else byte for byte |
| `cockpit_form_schema_check(jsonb)` | `30b96e79a5257d98cb0c22b5d00d7af9` | owner | `i` | types `file`, `date`, `number`, `heading`, text `format` (3.6) |
| `cockpit_form_answers_check(jsonb,jsonb,jsonb)` | `ae2318509ab88246c8b9deb15ef6c8b6` | owner | `i` | the same types; codes `file_missing`, `file_type`, `file_size`, `format`; declared `STABLE` (live `IMMUTABLE`, 11.2-c: it now reads `storage.objects`; it is called only from the submit functions, never in a CHECK) |
| `cockpit_form_card_allows(text,text)` | `d6f88a6602190b25c3e795124bd95335` | owner | `i` | `bank_receipt`: the card is on the billing sheet and not Stopped; `onboarding`: refused (`An onboarding answer is already stored for {client} ({date}).`) when the card has any stored onboarding answer (`cockpit_client_onboarding.forms.onboarding` with any `form_id`, or any `cockpit_form_responses` row `onboarding` not `withdrawn`) or a stored kickoff (`forms.kickoff`, any `form_id`); a departure with `returned_on` is closed |
| `cockpit_form_invite_issue(text,text,text[],text,text,boolean,jsonb,uuid,text)` | `d1240e841250b3fb3d89f78af903ff4e` | authenticated | `i` | origin `billing` for `bank_receipt` with its context rule (3.6) |
| `cockpit_form_invite_issue_system(text,text,text[],jsonb,text)` | `408eeff14da78b14089948764b306a5c` | owner | `i` | origin `portal` for `onboarding` (called by `j`'s portal open) |
| `cockpit_form_invite_view(text)` | `8822e64244f5b953756108fd9a1e16a4` | authenticated | `i` | `bank_receipt` listed with its `why`; `onboarding` listed |
| `cockpit_form_invite_canary(text,jsonb,text[])` | `d59801aa8335418583ef8635355e54df` | owner | `i` | `bank_receipt` and `onboarding` contexts |
| `portal_form_get(text,text,text,text,uuid)` | `507d4b31908437433eebea478c728439` | service_role | `i` | returns `fileSlots` state per file field |
| `cockpit_manual_payments_to_check()` | `d0651c549d7fe53714705dd537ea1a27` | authenticated | `i` | each row carries `receipt` (from the inbox or `cockpit_payment_receipts`) and `askable` |
| `cockpit_client_lifecycle_confirm(text,jsonb)` | `559e2d89e5e53c269f8d200a1c03e354` | authenticated | `i` | act `reactivate` (4.12) |
| `cockpit_csm_churn_read()` | `47e621e9a67da0fc195d87d407885497` | authenticated | `i` | each departure carries `returnedOn` |
| `cockpit_form_prefill(text,text)` | `c8b2a34b4b1635844ddd310c7ec2d217` | authenticated | `i` | form `reactivate` |
| view `cockpit_client_lifecycle_v` | viewdef md5 `43a401c28835ecd33b5c5c545eaa86cd` | service_role, read-only user | `i` | a `returned` state after a departure with `returned_on` |
| `cockpit_forms_effects_valid(jsonb)` | `1f6acfa213bd2516c618568c866ddf9e` | owner | `j` | delivery `relay` |
| `cockpit_form_effect_gate(text,text)` | `c679cd114e6aa8d5e2dccbfb4207d1c8` | owner | `j` | stage 4 effect keys and the `relay` delivery; every other branch byte for byte |
| `cockpit_client_message_claim(text[],text[],integer)` | `937293e8d0421580fc47f8341ff9cae2` | service_role | `j` | kinds `phase3`, `phase4` |
| `cockpit_client_message_view(cockpit_client_messages)` | `5145dbe3460c3947c82c8420871581ef` | owner | `j` | labels for `phase3`, `phase4` |
| `cockpit_client_message_approve(uuid,text,text,uuid,text[])` | `2de20d1e0f44a1e379e5b57848d6a8e0` | service_role | `j` | `phase3`/`phase4` bodies pass `cockpit_client_text_ok`, ≤ 1,500 characters |
| `cockpit_form_record_legacy(jsonb)` | `0c58ecc6de3d27a56d618e20ecffdfc3` | service_role | `j` | accepts `kickoff` once its registry row is native (stored `legacy`, `legacy.received` queued); an `onboarding` Typeform delivery after go-live goes to `cockpit_form_onboarding_typeform` instead (X26), and to `legacy` only when the card already has an answer |

**Not replaced by any file here:** `cockpit_ceo_action` (`ltv.preview` stays the read-only preview;
the apply is refused in the Edge Function, 4.5), `cockpit_ceo_refresh_finance_snapshot` (its ties key
is `to_jsonb(t)`, so `win_id` reaches the snapshot without a change; D0 re-checks the md5
`742d03b03c8112a3fbf94ef506d8ee81`), `cockpit_billing_write` (`bf105575a2d3a091b84ba1e3756c6520`),
`cockpit_billing_ingest_inbox` (it takes every pending inbox row whatever its source and writes it
`logged`, W12 CK), `cockpit_billing_writeback_enqueue` (only the trigger's `WHEN` changes, in `g`),
`cockpit_form_submit`, `portal_form_submit`, `portal_form_token_submit` (they call the answers check,
which learns the new types), `cockpit_form_client_submitted` (it calls `cockpit_form_hook_<key>` by
name), `cockpit_form_client_go_live` (unchanged: `bank_receipt` and `onboarding` go live through it;
`j`'s `cockpit_form_stage4_go_live` calls it), `cockpit_form_record_make`, `cockpit_pay_compute`
(proposals are confirmed into ordinary entries, which it already reads), `cockpit_request_submit`
(system requests have their own owner-only function).

### 2.3 `20261102g_money_rails_w5.sql` (money-rails)

| Object | Kind | Grant | Notes |
|---|---|---|---|
| `cockpit_slack_notices_kind_check`, `cockpit_slack_notice_settings_kind_check`, `cockpit_slack_notice_settings_check` (has a channel) gain `win.logged`, `receipt.in`, `client.reactivated` | CHECK swaps | | guarded |
| the eleven notice functions of 2.2 | replaced | as 2.2 | texts of 3.9 |
| `cockpit_slack_notice_settings` rows for the three kinds, `enabled = false`, channels: `win.logged` and `client.reactivated` → `csm-announcements`, `receipt.in` → `csm-general` | seed `ON CONFLICT DO NOTHING` | | |
| `cockpit_billing_events_kind_check` gains `win`, `reactivate` | CHECK swap | | guarded |
| trigger `cockpit_billing_events_clickup_writeback` | dropped and recreated | | `WHEN ((NEW.source IN ('ceo','csm') AND NEW.kind IN ('method','plan','amount','date','extension','pause','resume','payment','note','churn','mrr','win','reactivate')) OR (NEW.source = 'system' AND NEW.kind IN ('extension','ltv','late','survey','nps_sent')))` |
| writes, comment, detail, canary, daily run, balance write, balances read, doors | replaced | as 2.2 | |
| `cockpit_settings` `billing.ltv` `{"on":false,"maxDeltaUsd":5000}`, `billing.confirm_date` `{"on":false,"windowDays":7}`, `billing.agent` `{"separated":false}` (written by D-AG, 4.5); `forms.doors` merged with `{"agent":false,"ltv":false,"wins":false,"receipts":false,"reactivate":false}` | seed | | existing keys win (2.1): `excluded.value \|\| cockpit_settings.value`, guarded by `?&` on the seeded keys |
| `cockpit_ltv_plan(p_today date) RETURNS TABLE (task_id text, client_name text, stage text, baseline numeric, baseline_day date, checked_usd numeric, rows integer, target numeric, card numeric, delta numeric, state text, why text)` | function, `STABLE` | none | 4.4; `state` in `write`, `same`, `held`, `missing`, `out_of_scope`; the guards of `ltv.preview` as refusals in `why` |
| `cockpit_ltv_held` (`id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`, `task_id text NOT NULL`, `target numeric NOT NULL`, `card numeric`, `delta numeric NOT NULL`, `first_held_on date NOT NULL`, `released_by text`, `released_at timestamptz`) | table | service_role `SELECT, INSERT, UPDATE` | a held jump; unique partial index on `(task_id) WHERE released_at IS NULL` (one open hold per card); released rows kept, so a card can be held again later; audit |
| `cockpit_ltv_read()` | browser RPC, `STABLE` | authenticated | CEO or finance: `{asOf, on, rows:[...plan], held:[...], lastRun}` |
| `cockpit_ltv_release(p_task_id text, p_target numeric, p_note text)` | browser RPC | authenticated | CEO only; writes one `ltv` event (source `system`, `detail.released_by`) for a held row whose target is unchanged since the read |
| `cockpit_agent_keys` (`id bigint GENERATED ALWAYS AS IDENTITY`, `agent text NOT NULL CHECK (agent IN ('billing_agent'))`, `key_sha256 text NOT NULL UNIQUE CHECK (key_sha256 ~ '^[0-9a-f]{64}$')`, `note text CHECK (note IS NULL OR char_length(note) <= 200)`, `added_by text NOT NULL`, `added_at timestamptz NOT NULL DEFAULT now()`, `revoked_by text`, `revoked_at timestamptz`, `revoked_reason text`) | table | service_role `SELECT, INSERT, UPDATE` | at most one unrevoked key per agent (partial unique); the audit trigger never copies `key_sha256`; no delete |
| `cockpit_agent_calls` (`id bigint identity`, `key_id bigint NOT NULL REFERENCES cockpit_agent_keys(id)`, `at timestamptz NOT NULL DEFAULT now()`, `op text NOT NULL`, `request_id uuid`, `outcome text NOT NULL CHECK (outcome IN ('ok','refused','limited','duplicate'))`, `detail jsonb NOT NULL DEFAULT '{}'` ≤ 2 KB, never a secret) | table | service_role `SELECT, INSERT` | unique `(key_id, request_id)` where `request_id` not null; a `duplicate` row is written with `request_id` NULL and `detail.firstCallId`; index `(key_id, at)` |
| `cockpit_agent_key_put_owner(p_agent text, p_key_sha256 text, p_note text, p_actor text)` | function | none (owner, deploy only) | revokes the agent's previous key with reason `Replaced` and inserts the new one |
| `cockpit_agent_keys_read()`, `cockpit_agent_key_revoke(p_id bigint, p_reason text)` | browser RPCs | authenticated | CEO only: `{keys:[{id, agent, note, addedAt, revokedAt, lastCallAt, callsToday}]}` (never a hash) |
| `cockpit_billing_agent_write(p_key_sha256 text, p_op text, p_body jsonb, p_request_id uuid)` | function, `VOLATILE` | service_role | 3.4 |
| `cockpit_billing_agent_read(p_key_sha256 text, p_what text, p_args jsonb)` | function, `VOLATILE` (it writes its `cockpit_agent_calls` row; Postgres refuses an INSERT in a `STABLE` function) | service_role | 3.4 |

### 2.4 `20261102h_wins_pay.sql` (wins-pay)

| Object | Kind | Grant | Notes |
|---|---|---|---|
| `cockpit_csm_wins` (3.2) | table | service_role `SELECT, INSERT, UPDATE` | unique `request_id`; index `(task_id, won_on)`, `(stage)`; unique partial `(referral_deal_response_id) WHERE stage <> 'void'`; unique partial `(departure_id) WHERE kind = 'reactivation' AND stage <> 'void'`; audit; no delete; a guard trigger allows only the stage moves of 3.2 |
| `cockpit_csm_win_events` (3.2) | table | service_role `SELECT, INSERT` | index `(win_id, at)`; audit; no delete |
| `cockpit_win_tie_proposals` (3.2) | table | service_role `SELECT, INSERT, UPDATE` | unique partial `(payment_id) WHERE state = 'open'`; audit; no delete |
| `cockpit_payment_ties` column `win_id uuid REFERENCES cockpit_csm_wins(id)`; unique partial index `cockpit_payment_ties_one_win_per_payment` on `(payment_id) WHERE win_id IS NOT NULL AND cleared_at IS NULL`; CHECK `win_id IS NULL OR (payment_id IS NOT NULL AND clickup_task_id IS NOT NULL)` | column, index, CHECK | | a win tie is always a payment tie to the win's card (the live `one_target` CHECK keeps one target) |
| `cockpit_invoices` column `win_id uuid REFERENCES cockpit_csm_wins(id)` | column | | set only through `cockpit_csm_win_invoice_link` |
| `cockpit_pay_proposal_decisions` (`key text PRIMARY KEY`, `month date NOT NULL CHECK (extract(day from month) = 1)`, `decision text NOT NULL CHECK (decision IN ('confirmed','declined'))`, `entry_id bigint REFERENCES cockpit_pay_entries(id)`, `reason text CHECK (reason IS NULL OR char_length(reason) BETWEEN 3 AND 300)`, `decided_by text NOT NULL`, `decided_at timestamptz NOT NULL DEFAULT now()`) | table | service_role `SELECT, INSERT` | a confirmed key has `entry_id`; audit; no delete |
| `cockpit_forms` row `win` (native, audience team, seats `{csm}`, schema `{lives:'cockpit'}`, effects `[]`) and version 1 | seed | | the sheet is code-defined (V13 of W34) |
| `cockpit_settings` `pay.proposals` `{"on":false}` | seed | | |
| `cockpit_csm_win_log(p jsonb)`, `cockpit_csm_win_stage(p jsonb)`, `cockpit_csm_wins_read(p_task_id text)`, `cockpit_csm_wins_list(p_from date, p_to date)`, `cockpit_csm_wins_today()`, `cockpit_win_tie_candidates(p_win_id uuid)`, `cockpit_csm_win_tie_propose(p jsonb)`, `cockpit_ceo_win_tie_decide(p jsonb)`, `cockpit_ceo_win_tie_clear(p jsonb)`, `cockpit_csm_win_invoice_link(p_win_id uuid, p_invoice_id text)` | browser RPCs | authenticated | 3.3 |
| `cockpit_ceo_payment_tie(jsonb)`, `cockpit_ceo_payment_untie(jsonb)` | replaced | as 2.2 | an ordinary tie or untie can never displace or clear a win tie |
| `cockpit_win_closer_paid(p_payment_id text) RETURNS jsonb` | function, `STABLE` | none | `{month, closer}` when the payment is an active `cockpit_deal_payments` row whose month (`date_trunc('month', day)`) is on or before `cockpit_pay_last_approved()`, else NULL; read by the decide and clear acts and the test |
| `cockpit_ceo_pay_proposals(p_month date)`, `cockpit_ceo_pay_proposal_decide(p jsonb)` | browser RPCs | authenticated | 3.3, 4.9 |
| `cockpit_csm_win_import(p jsonb)` | function | none (owner, deploy only) | the 35 old wins (4.2.4): inserts `void` wins with `source 'import'` and one `imported` event each, idempotent on `imported_from`; it writes no billing event, no card comment, no notice and no form response |
| `cockpit_win_pay_rows(p_month date)` | function, `STABLE` | none | the proposal rule of 4.9 as rows; read by both pay RPCs and the test |
| `cockpit_ceo_pay_entry_save(jsonb)` | replaced | as 2.2 | 4.9 |
| view `cockpit_wins_v` (one row per non-void win: `id, task_id, client_name, kind, stage, won_on, quoted_usd, recurring, monthly_usd, csm_person_id, tied_checked_usd, paid_on, imported`) | view | service_role, `supabase_read_only_user` `SELECT` | read by the CEO refresh (goals, lock-in, metrics); helpers granted EXECUTE to the read-only user |
| `cockpit_settings` `forms.doors.wins` | not touched | | seeded by `g`; flipped at D-W |

### 2.5 `20261102i_client_tail.sql` (client-tail)

| Object | Kind | Grant | Notes |
|---|---|---|---|
| `storage.buckets` row `cockpit-form-files` (private, `file_size_limit` 10485760, `allowed_mime_types` `{image/jpeg,image/png,image/webp,image/heic,application/pdf}`) | seed `ON CONFLICT DO NOTHING` | | no storage policy for anon or authenticated; the service key only (the portal server and the cockpit forms door) |
| `cockpit_form_file_slots` (3.6) | table | service_role `SELECT, INSERT, UPDATE` | unique `path`; at most 5 slots per `(invite_id, field_key)`; audit; no delete |
| `cockpit_payment_receipts` (`id bigint identity`, `manual_payment_id text NOT NULL REFERENCES cockpit_manual_payments(id)`, `response_id uuid NOT NULL UNIQUE REFERENCES cockpit_form_responses(id)`, `path text NOT NULL`, `amount numeric`, `currency text`, `paid_on date`, `reference text`, `added_at timestamptz NOT NULL DEFAULT now()`) | table | service_role `SELECT, INSERT` | a receipt that answers an already logged payment; audit; no delete |
| `cockpit_billing_inbox_source_check` gains `portal`; column `response_id uuid REFERENCES cockpit_form_responses(id)` (unique when not null) | CHECK swap, column | | guarded |
| trigger `cockpit_billing_inbox_portal_twin` (`AFTER UPDATE OF status ON cockpit_billing_inbox`, `WHEN (NEW.source = 'portal' AND NEW.status = 'duplicate' AND NEW.response_id IS NOT NULL AND NEW.ledger_id IS NOT NULL)`) → `cockpit_billing_inbox_portal_twin()` | trigger, function | none | inserts one `cockpit_payment_receipts` row against `NEW.ledger_id` (`ON CONFLICT (response_id) DO NOTHING`), so a receipt whose transfer was already logged is shown on that twin (4.10.3); ingest itself is not replaced |
| `cockpit_form_invites_purpose_check` gains `bank_receipt`, `onboarding`; `cockpit_form_invites_origin_check` gains `billing`, `portal` | CHECK swaps | | guarded; `purpose = form_key` (live `_check`) stays |
| schema check, answers check, card allows, invite issue, issue system, view, canary, `portal_form_get`, checks list, lifecycle confirm, churn read, prefill, lifecycle view | replaced | as 2.2 | |
| `cockpit_forms` rows `bank_receipt` (native, client, seats `{csm}`) and `reactivate` (native, team, seats `{csm}`, schema `{lives:'cockpit'}`) with version 1 | seed | | `bank_receipt` schema per 5.8 |
| `cockpit_form_hook_bank_receipt(p_response_id uuid)`, `cockpit_form_issue_hook_bank_receipt(p_invite_id uuid)` | functions | none | 4.10 |
| `portal_form_file_slot(p_location_id text, p_clickup_id text, p_person text, p_invite_id uuid, p_field text, p_mime text, p_bytes bigint, p_sha256 text)`, `portal_form_token_file_slot(p_token_sha256 text, p_net_hash text, p_browser_hash text, p_field text, p_mime text, p_bytes bigint, p_sha256 text)` | portal RPCs | service_role | 3.6 |
| `cockpit_form_file_read(p_response_id uuid, p_field text)` | browser RPC, `STABLE` | authenticated | the gate of `cockpit_form_answer_read`; returns `{path, mime, bytes}` for the forms door to sign |
| `cockpit_churn_departures` columns `returned_on date`, `return_event_id bigint REFERENCES cockpit_billing_events(id)`, `returned_by text` | columns | | written only by the `reactivate` act |
| `cockpit_retire_items` (3.7) and its seed (11.3) | table, seed | service_role `SELECT, INSERT, UPDATE` | audit; no delete |
| `cockpit_retire_item_set(p_id text, p_patch jsonb, p_actor text)` | function | none (owner, deploy only) | state moves of 3.7, rollbacks included (`off`, `closed` or `removed` back to `on` with `note` and `step`) |
| `cockpit_retire_items_read()` | browser RPC, `STABLE` | authenticated | CEO or admin |
| view `cockpit_retire_items_v` | view | service_role, `supabase_read_only_user` | read by the guardian |

### 2.6 `20261102j_stage4_native.sql` (stage4)

| Object | Kind | Grant | Notes |
|---|---|---|---|
| `cockpit_form_versions` `kickoff` version 2 (staff marker `{lives:'cockpit', fields:[{key, typeformRef, title}]}`, 4.13) and `onboarding` version 2 (client schema v1, 5.9). Registry rows stay `provider = 'typeform'`, version 1, with their live effects arrays (11.2-d), until `cockpit_form_stage4_go_live` | seed | | the 30 stored kickoff answers and 46 onboarding answers keep version 1 |
| `cockpit_form_stage4_effects(p_form_key text, p_version integer) RETURNS jsonb` | function, `IMMUTABLE` | none | the whole effects array for each form and version as constants: version 1 = the live arrays of 11.2-d byte for byte; version 2 = 4.15.2's arrays; anything else raises. `20261102l` drops `client_data_row` from both onboarding arrays (2.8) |
| `cockpit_form_onboarding_typeform(p_payload jsonb)` | function | service_role (forms-door) | X26: maps a `KFRCXPFx` delivery by `typeformRef` into version-2 answers (the same mapping `cockpit_form_parity_plan` uses), stores the response (`source 'typeform'`, version 2, state `submitted`) and runs `cockpit_form_hook_onboarding`; a card that already has an answer (2.2 card allows rule) is stored `legacy` instead |
| `cockpit_form_option_maps` (`form_key text`, `field_id text`, `answer text`, `option_name text NOT NULL`, PK `(form_key, field_id, answer)`) | table | service_role `SELECT` | the nine kickoff dropdowns (4.13), seeded from the stored field map by option name; D-S4.0 compares them with Make 12's `switch()` |
| `cockpit_settings` `forms.stage4` `{"kickoff":false,"onboarding":false}`, `onboarding.map_urls` `{}` (filled at D-S4.0 from the saved blueprints), `stage4.messages` `{}` (phase 3 and phase 4 texts with `{map_link}` and `{content_folder}`, filled at D-S4F, X35) | seed | | the run refuses an empty `map_urls` or `messages` entry with a sentence, never sends a blank |
| `cockpit_client_messages_kind_check` gains `phase3`, `phase4` | CHECK swap | | guarded |
| `cockpit_requests_source_check` gains `form`; `cockpit_requests_check1` becomes `(source IN ('import','form')) OR (requester_member_id IS NOT NULL)`; column `form_response_id uuid REFERENCES cockpit_form_responses(id)` (unique per `(form_response_id, type_key)`) | CHECK swaps, column | | guarded |
| `cockpit_form_relay_outbox` (3.8) | table | service_role `SELECT, INSERT, UPDATE` | unique `dedupe_key`; audit; no delete |
| `cockpit_kickoff_prefill(p_task_id text)`, `cockpit_kickoff_submit(p_task_id text, p_answers jsonb, p_request_id uuid)` | browser RPCs | authenticated | 3.3, 4.13 |
| `cockpit_kickoff_answers_check(p_answers jsonb) RETURNS jsonb` | function, `IMMUTABLE` | none | `{ok, errors}` with the codes of W34 3.1 plus `format` |
| `cockpit_form_hook_onboarding(p_response_id uuid)` | function | none | 4.14 |
| `portal_form_onboarding_open(p_location_id text, p_clickup_id text, p_person text, p_role text)` | portal RPC | service_role | 3.3 |
| `cockpit_form_stage4_plan(p_response_id uuid, p_apply boolean)` | function | none | the effect planner for both forms (4.13, 4.14); `p_apply false` returns the plan only |
| `cockpit_form_parity_plan(p_form_key text, p_input jsonb)` | function, `STABLE` | none (owner, deploy only) | the plan for a recorded Make input, for `make_parity.py` (4.15) |
| `cockpit_form_stage4_go_live(p_form_key text, p_on boolean, p_actor text)` | function | none (owner, deploy only) | 4.15 |
| `cockpit_request_create_system(p_type_key text, p_task_id text, p_answers jsonb, p_response_id uuid)` | function | none | inserts a `source = 'form'` request (Brand DNA, the two onboarding tasks), deduped per response **and per card**: a card that already has a live (not cancelled) request of that type made by a form gets none (`skipped: already made for this client`); the tasks Make made before go-live are covered by the once-per-card rule of 4.14 (every card Make served has a stored kickoff or onboarding answer, 11.2-o) |
| `cockpit_form_relay_claim(p_limit integer)`, `cockpit_form_relay_done(p_id bigint, p_claim uuid, p_outcome text, p_detail jsonb)` | worker RPCs | service_role | 3.8 |
| `cockpit_forms_effects_valid`, `cockpit_form_effect_gate`, three client-message functions, `cockpit_form_record_legacy` | replaced | as 2.2 | |
| `cockpit_settings` `forms.doors` | not touched | | the `kickoff` flag reads `forms.stage4.kickoff` |

### 2.7 Portal-side schema

None in a database. The portal adds no storage keys: uploads go straight to the cockpit bucket by a
signed upload URL (3.6), drafts stay in the browser.

### 2.8 `20261102l_stage4_no_client_data_row.sql` (D-S4.0 fix, X34)

Written after D-S4.0 found that Make 13 [31] only searches Client Data. It stands on `j`, applies twice,
and copies `i` and `j`'s drift guard. The content folder (X35) needs no SQL change:
`cockpit_form_stage4_message` already leaves `{content_folder}` in the text, and the approve,
claim and view functions pass the body through unchanged (live md5s read 2026-11-02, equal to the repo).
`20261102m` (2.9) is the later match-Make change, not the content folder.

| Object | Kind | Grant | Notes |
|---|---|---|---|
| `cockpit_form_stage4_effects(text,integer)` | replaced; guard live md5 `afa3e203fa6dda7182d9352b38254c0e` (`j`'s body), after `1b01ccc56e88b8fa4f4fc8985d36c93c` | owner only (ACL kept, revoked again from the four roles) | both onboarding arrays lose `client_data_row`; version 1 drops Make's entry rather than relabelling it, because [31] writes nothing: it is a search that gates [49] to [48] (`map_phase3` and `phase3_whatsapp` run once per row it finds, 11.8), while Make 12's [24] comes after the map edit [26] and gates only `phase4_whatsapp`; the kickoff arrays are unchanged |
| `cockpit_form_stage4_build(jsonb)` | replaced; guard live md5 `a704e72a3921191d2f06a24855d7f219`, after `7e5f7fdaadc74983367cd07bd8c56e3c` | owner only | plans no `client_data_row`; every other effect and the order are `j`'s |
| `cockpit_form_relay_outbox` CHECKs | narrowed | | `effect_key = 'github_dispatch'`, `dedupe_key ~ '^relay:[0-9a-f-]{36}:github_dispatch$'`; each narrowed only from `j`'s exact definition; the file stops while any `client_data_row` row exists (live 2026-11-02: none) |
| onboarding registry row | data | | `j`'s version-1 array becomes the new version 1, `j`'s version-2 array (after a go-live) the new version 2, so `cockpit_form_stage4_go_live`'s drift check still passes; any other array stops the file (`The onboarding effects changed since 20261102j; stop and re-read them.`); one audit row `forms.stage4_no_client_data_row` |

Unchanged, because none names `client_data_row`: the planner, the parity plan, `cockpit_forms_effects_valid`,
`cockpit_form_effect_gate` and the relay's claim, done and counts. PGlite: `stage4-native-supabase.test.ts`
applies `l` after `j` (37 pass); `stage4-content-folder-supabase.test.ts` proves both phase templates pass
`cockpit_form_stage4_message` unchanged (5 pass).

### 2.9 `20261102m_stage4_match_make.sql` (D-S4F fix, X37)

Written after the CEO's "Yes, match Make" (X37, 11.9): for the same answers the native kickoff and onboarding
write what Make 12 (`8925654`) and Make 13 (`8922994`) write, byte for byte where Make writes text. The
reference is `scripts/dev/make_parity.py`'s evaluator of the saved blueprints (X36). It stands on `l`: while
the builder is still `j`'s (`a704e72a…`), or a function it reads is missing, it stops with `Apply 20261102l
before 20261102m.` (`55000`). It applies twice and copies `l`'s drift guard: each replaced body must be the
live one (read 2026-11-02) or this file's own, and for the builder `l`'s after value, because `l` replaces it
first; anything else stops the file with `<function> changed since 20261102l; stop and re-read it.` (`55000`).

| Object | Kind | Grant | Notes |
|---|---|---|---|
| `cockpit_form_stage4_make_text(text,text)` | new, `IMMUTABLE` | owner only | an answer as Make writes it in text (the evaluator's `typed()` then `to_text()`): a number question's answer without trailing zeros, 0 as nothing, Arabic-Indic digits read as digits; any other answer as it is |
| `cockpit_form_stage4_handoff_text(jsonb,jsonb)` | new | owner only | Make 12 [11]'s 110 lines as the saved blueprint has them (the same text [18] and [23] post): an empty hidden value or answer is `Not provided` (`ifempty`); each yes/no line is `Yes` for yes or true, `No` for no or false (case and surrounding space ignored), and `Not provided` for any other answer or none (`switch`); a Payment Amount of 0 is `Not provided`; a list keeps the order it was ticked |
| `cockpit_form_stage4_profile_text(jsonb)` | new | owner only | Make 13 [29]'s `7755485f`: `Last Year's Total Revenue`, `90-Day Goal Revenue`, `12-24 Month Revenue Goal`, `Marketing they've tried A-Z`, `Top 3 challenges`, `Why they joined`, `Additional notes`, a blank line between, each label kept when its answer is empty, a revenue of 0 blank, never cut |
| `cockpit_form_stage4_raw_answers_text(jsonb,jsonb)` | new | owner only | Make 13 [41] to [42] to [47]: `**Raw Onboarding Form Answers**`, a blank line, then each answered question in `KFRCXPFx`'s order as `**<its full title>**`, its answer and a blank line; a revenue of 0 is a blank line; a question answered twice takes its last answer; an answer whose ref has no title keeps its own title and comes after the titled ones, in answer order |
| `cockpit_settings` `onboarding.raw_titles` = `{}` | seed `ON CONFLICT DO NOTHING` | | `{fields:[{ref, title}]}`, an array because jsonb loses key order and the comment needs the form's order (X20); filled at D-S4F from `scripts/dev/forms-deploy/stage4-raw-titles.json`: the 36 questions of the saved `KFRCXPFx` in its order, with its full titles (no person's name) |
| `cockpit_requests.task_comment text` | column, `IF NOT EXISTS` | | the comment each task of a request gets once it is made, whole: the handoff for the two onboarding tasks, NULL for every other request; the audit row holds its length, never its text |
| `cockpit_form_stage4_fields(text)` | replaced; guard live `8c36fd1cf1b0a60b0c776241765eddf7` (`j`'s), after `032868f54e17a1cbeacc417fb2d0dcb9` | owner only | kickoff: `j`'s 41 plus `tG7dnxBn`'s five follow-ups that Make 12 [11] prints, each after the question it follows, with `tG7dnxBn`'s titles: `detailsCorrection` (`c0000001-…-0012`), `linksCorrection` (`-0013`), `operationsCorrection` (`-0014`), `profileMissing` (`-0015`), `contractChanges` (`-000b`); `postCallFormFilled` becomes a Yes or No choice, as in `tG7dnxBn`. `cockpit_kickoff_answers_check` reads this list, so it takes the five and refuses any other answer to Post call form filled. The onboarding's 36 are unchanged. The kickoff's version-2 record in `cockpit_form_versions` still lists the 41; the submit never checks against it |
| `cockpit_form_stage4_hidden(text)` | replaced; guard live `cb8d434b635091957a15c7ca96652848` (`j`'s), after `c43644ee277f532770e523e61e389aad` | owner only | what Make 13 [29]'s Kickoff Form Link carries for the card's stored onboarding answer: each answer as stored (never trimmed; the last answer of a question answered twice), the appointment types joined with `,` in the order ticked (`encodeURL` of a list), a revenue as Make's number (0 is nothing); a missing or empty answer is left out, so the handoff says `Not provided`; the business name no longer falls back to the card's name. Read by `cockpit_form_stage4_input` and the kickoff sheet's prefill |
| `cockpit_form_stage4_typeform_answers(text,jsonb)` | replaced; guard live `97ec3ad0bb4d2282c518be1447d4f262` (`j`'s), after `c9ad150b861d72d497ccb6f3af16cf7e` | owner only | a list keeps the order it was ticked, for both forms, each option once where it was first ticked (`j` used the form's option order), so the read model and every text list a native answer as Typeform hands a multi choice to Make |
| `cockpit_form_stage4_build(jsonb)` | replaced; guard `l`'s after `7e5f7fdaadc74983367cd07bd8c56e3c`, after `38533746dda5da0468717e304443fef1` | owner only | `l`'s, with Make's texts and choices: the handoff; `onboarding_tasks` carries the whole handoff as `comment_text`, and also keeps `l`'s details (the handoff's first 4,000 characters) as the tasks' description until the request writer posts the comment (11.9: a stopgap Make does not have; the change that adds the writer's step drops it); Service Advertised is `switch(first(list))`, the option ticked first, and nothing when that one is not an option; the Client Profile, cut at 5,000 characters as `l` cut it while `clickup-writeback` refuses a longer text (11.9); the raw answers comment, or `missing` with a sentence (nothing posted) while `onboarding.raw_titles` is empty, malformed or has no title for an answered question; the dispatch's `client` is the typed Business Name answer (`514bfd3f`) as typed, or an empty text; the Brand DNA task has no details. `stage4.templates` no longer shapes any text. Every other effect is `l`'s byte for byte |
| `cockpit_request_create_system(text,text,jsonb,uuid)` | replaced; guard live `295e926095e7832e7d7a220b4d233a23` (`j`'s), after `45207dde9903fee3c1d0aa0b20eea18f` | owner only | `j`'s, plus the plan's `comment_text` beside the details: kept whole on `task_comment` and in each part's queue payload as `taskComment`, never in the description or the answers |
| `cockpit_form_stage4_plan(uuid,boolean)` | replaced; guard live `cb27a3730e539bcfbb46dea136af96ae` (`j`'s), after `fafbabb9a934a5343f205c998e8823cd` | owner only | `j`'s, except that a system request is handed the plan's `comment_text` beside its details; `onboarding_tasks` still reads `delivered` once the request exists |

Unchanged: `cockpit_form_stage4_input` and `cockpit_form_parity_plan` (`j`'s; they read the replaced field list,
hidden values and answers list by name), `cockpit_form_stage4_native_answers`, both effects arrays, the relay
outbox, `stage4.messages`, and every effect not named above. `m` writes no audit row, posts nothing, writes no
card, sends nothing and reaches no sheet. All ten functions are revoked from PUBLIC, anon, authenticated and
service_role (owner only, as `j` left them). `guard_check.py supabase/migrations '20261102m*'` read 2026-11-02:
`n` 6, `live` 5, `odd` the builder (live holds `j`'s until `l` applies; then it reads `l`'s after value).
PGlite: `stage4-match-make-supabase.test.ts` (25 pass) cuts the functions it needs from their migrations,
proves each replaced body is the live one (`l`'s for the builder), keeps `l`'s under `_l` names and compares
every effect with `l`'s and with the evaluator. `stage4-native-supabase.test.ts` still stops at `l`; adding `m`
to it changes what `l`'s cases assert (Service Advertised, list order, the raw comment without titles,
the dispatch name, `l`'s own re-apply guard), so those cases change with it.

---

## 3. Shapes every slice builds to

### 3.1 Words and codes used everywhere

| Code | Screen word (staff) | Meaning |
|---|---|---|
| win kind `review` | Google review | proof: a review link or a screenshot link |
| `video_testimonial` | Video testimonial | proof: a link to the video |
| `podcast` | Podcast case study | proof: the episode link |
| `referral` | Referral | the referred person's signed deal (`cockpit_sales_deals.response_id`) |
| `renewal` | Renewal | an agreement link or a tied payment |
| `reactivation` | Reactivation | an agreement link or a tied payment (also made by Reactivate, 4.12) |
| `upsell_website`, `upsell_smm`, `upsell_backend`, `upsell_seo_geo`, `upsell_second_campaign` | Website, Social media management, Back-end programme, SEO and AI search, Second campaign | an upsell, staged |
| stage `logged` | Logged | a non-upsell win with its proof |
| `quote_given` | Offered | a sent proposal or a proof link with the quoted price |
| `signed` | Accepted | an agreement is linked |
| `paid` | Paid | a CEO-confirmed tie of a checked payment |
| `void` | Voided | with a reason; pays nothing |

### 3.2 Tables

`cockpit_csm_wins`:

| Column | Rule |
|---|---|
| `id uuid PRIMARY KEY` | `gen_random_uuid()` |
| `request_id uuid NOT NULL UNIQUE` | the seat's request id; a retry returns the first win |
| `task_id text NOT NULL` | `^[A-Za-z0-9_-]{1,40}$`; on the billing sheet, or `86eywg1cq` (canary) |
| `client_name text NOT NULL` | from `cockpit_billing_accounts` |
| `kind text NOT NULL CHECK (kind IN (... 3.1 ...))` | |
| `stage text NOT NULL CHECK (stage IN ('logged','quote_given','signed','paid','void'))` | non-upsell kinds: `logged` or `void` only; upsell kinds: `quote_given`, `signed`, `paid`, `void` (CHECK on the pair) |
| `won_on date NOT NULL` | Kuwait day; today or within the last 30 days at log time (an import keeps its own date) |
| `proof_url text` | `^https://` ≤ 1000; required for review, video testimonial, podcast; for an upsell required when no `proposal_id` |
| `proposal_id uuid REFERENCES cockpit_upsell_proposals(id)` | upsell from Offer Studio: the proposal's `status` must be `sent`, `link_copied` or `accepted` (never `draft`, `archived`, `not_now` at log time) |
| `quoted_usd numeric` | upsells: > 0, ≤ 1,000,000 |
| `list_usd numeric`, `below_list_reason text` (3..140) | the reason required when `quoted_usd < list_usd` (Offer Studio's list price or the catalog's) |
| `recurring boolean NOT NULL DEFAULT false`, `monthly_usd numeric` | `monthly_usd > 0` required when recurring |
| `agreement_url text` | `^https://` ≤ 1000; required to enter `signed`; optional proof for renewal and reactivation |
| `referral_deal_response_id text` | required for `referral`; the deal must be live and not voided; one non-void win per deal (unique partial index; `That deal is already logged as a referral win on {date}.`) |
| `departure_id bigint REFERENCES cockpit_churn_departures(id)` | set only on a `reactivation` win made by Reactivate (4.12); one non-void reactivation win per departure (unique partial index) |
| `csm_person_id bigint REFERENCES cockpit_people(id)` | the card's CSM on `won_on` (`cockpit_billing_accounts.csm` matched to `cockpit_people` by name, case and spacing folded); NULL when unmatched, then the CEO picks the person at confirm |
| `note text` | ≤ 500 |
| `source text NOT NULL CHECK (source IN ('cockpit','import','reactivate','canary'))` | |
| `imported_from text` | import only: `typeform:<form id>:<response id>` |
| `logged_by uuid`, `logged_by_email text`, `logged_by_role text NOT NULL` | roles on screens and cards, emails in the audit only |
| `logged_at timestamptz NOT NULL DEFAULT now()`, `updated_at` | |
| `voided_by text`, `voided_at`, `void_reason text` (3..300) | |

Stage moves (guard trigger): `quote_given → signed`, `quote_given → void`, `signed → paid`,
`signed → void`, `paid → signed` (only through `cockpit_ceo_win_tie_clear`), `paid → void` (CEO only,
after the tie is cleared), `logged → void`; anything else raises `22023 That win cannot move from
{stage} to {stage}.`

`cockpit_csm_win_events`: `id bigint identity`, `win_id uuid NOT NULL`, `at timestamptz NOT NULL DEFAULT now()`,
`event text NOT NULL CHECK (event IN ('logged','offered','accepted','proof_added','tie_proposed','tie_confirmed','tie_declined','tie_cleared','paid','invoice_linked','voided','imported'))`,
`by_role text NOT NULL`, `by_email text`, `detail jsonb NOT NULL DEFAULT '{}'` (≤ 2 KB).

`cockpit_win_tie_proposals`: `id bigint identity`, `win_id uuid NOT NULL REFERENCES cockpit_csm_wins(id)`,
`payment_id text NOT NULL CHECK (payment_id ~ '^(whop|tap|ecom|transfer|bank|manual):[A-Za-z0-9_.-]+$')`,
`usd numeric NOT NULL CHECK (usd > 0)`, `paid_on date NOT NULL`, `rail text NOT NULL`,
`state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','confirmed','declined','withdrawn'))`,
`proposed_by_email text`, `proposed_by_role text NOT NULL`, `proposed_at timestamptz NOT NULL DEFAULT now()`,
`decided_by text`, `decided_at timestamptz`, `reason text` (3..300), `tie_id bigint REFERENCES cockpit_payment_ties(id)`.

### 3.3 RPC signatures (every browser RPC: `SECURITY DEFINER SET search_path = ''`, gate first, an audit row for every write, refusals as plain sentences, `42501` who / `22023` what)

```
-- g (money-rails)
cockpit_ltv_read() RETURNS jsonb                                         -- authenticated, STABLE; CEO or finance
  -> {asOf, on, maxDeltaUsd, lastRun:{at, note}|null,
      rows:[{taskId, client, stage, baseline, baselineDay, checkedUsd, rows, target, card, delta,
             state:'write'|'same'|'held'|'missing'|'out_of_scope', why|null}],
      held:[{taskId, client, target, card, delta, heldOn}], loggedWaiting: int}
cockpit_ltv_release(p_task_id text, p_target numeric, p_note text) RETURNS jsonb      -- authenticated; CEO
  'Only the CEO releases a lifetime value jump.' / 'The amount changed since you looked. Reload it.' /
  'There is no held lifetime value for this client.'
cockpit_agent_keys_read() RETURNS jsonb; cockpit_agent_key_revoke(p_id bigint, p_reason text) RETURNS jsonb  -- CEO
cockpit_billing_agent_write(p_key_sha256 text, p_op text, p_body jsonb, p_request_id uuid) RETURNS jsonb  -- service_role
cockpit_billing_agent_read(p_key_sha256 text, p_what text, p_args jsonb) RETURNS jsonb                     -- service_role
  (3.4)

-- h (wins-pay)
cockpit_csm_win_log(p jsonb) RETURNS jsonb                               -- authenticated
  p = {requestId, taskId, kind, wonOn, proofUrl?, proposalId?, quotedUsd?, listUsd?, belowListReason?,
       recurring?, monthlyUsd?, agreementUrl?, referralDealResponseId?, note?, confirmDuplicate?}
  Gate: CEO, or a CSM allowed on the client (cockpit_csm_client_gate). Door marker 'wins' true (else
  'Log a win opens after its switch-on.'), except the test card for the canary.
  Upsell with proposalId -> stage quote_given ('Mark as offered'); a draft proposal: 'Send the proposal
  first. A draft is not a win.'; an upsell with agreementUrl at log -> logged as quote_given then
  moved to signed in the same call (two events).
  A review on the same card within 30 days, without confirmDuplicate -> {ok:false, warning:
  'A Google review was logged for {client} on {date}. Log this one too?'} (nothing stored). A renewal
  on the same card within 30 days warns the same way ('A renewal was logged for {client} on {date}.
  Log this one too?'). A referral whose deal already has a non-void win is refused ('That deal is
  already logged as a referral win on {date}.'). A manual reactivation on a card that has a non-void
  reactivation win in the last 60 days is refused ('{client} was reopened on {date} and that return
  already has its win.').
  Writes: the win, event 'logged'|'offered', a billing event kind 'win' (source csm|ceo) with detail
  3.5 (card comment, held until D-W), the notice win.logged (dedupe 'win:'||id), and a
  cockpit_form_responses row form_key 'win' state 'confirmed' source 'cockpit' (the history the forms
  pages read). Returns {ok, winId, stage, sentence:'Logged.'|'Marked as offered.'}.
cockpit_csm_win_stage(p jsonb) RETURNS jsonb                             -- authenticated
  p = {requestId, winId, act:'accept'|'void'|'proof', agreementUrl?, reason?, proofUrl?}
  accept: needs agreementUrl ('Add the signed agreement link to mark it accepted.'); void: reason
  3..300 ('Say why in 3 to 300 characters.'); a paid win voids only for the CEO after its tie is cleared
  ('Clear the payment tie first. Only the CEO voids a paid win.'). Event + billing 'win' comment on accept.
cockpit_csm_wins_read(p_task_id text) RETURNS jsonb                      -- authenticated, STABLE
  -> {wins:[WinRow], acceptedProposals:[{proposalId, offerName, acceptedAt}], doorOpen bool}
  WinRow = {id, kind, kindLabel, stage, wonOn, proofUrl, quotedUsd, recurring, monthlyUsd, agreementUrl,
            tiedUsd, tiedCheckedUsd, tiePending:{id, usd, paidOn}|null, invoiceId|null,
            pay:{state:'none'|'waiting'|'proposed'|'confirmed'|'declined', why|null, amountUsd|null},
            loggedByRole, loggedAt, voidReason|null}
cockpit_csm_wins_list(p_from date, p_to date) RETURNS jsonb              -- authenticated, STABLE
  CEO: every card; CSM: own cards. -> {wins:[WinRow + taskId, client], totals:{byKind, upsellsOffered,
  upsellsAccepted, upsellCashChecked}}
cockpit_csm_wins_today() RETURNS jsonb                                   -- authenticated, STABLE
  rows: 'accepted_no_agreement' (a proposal marked accepted with no signed win), 'invoice_paid_untied'
  (an invoice with win_id whose rail payment exists and has no tie proposal), 'tie_waiting' (CEO only:
  open tie proposals)
cockpit_win_tie_candidates(p_win_id uuid) RETURNS jsonb                  -- authenticated, STABLE
  rail payments on the win's card since 30 days before won_on that carry no live tie and are not a
  deal's own contract money. "Contract money" = an active cockpit_deal_payments row with
  kind 'deposit' or deposit_usd > 0, or one matched to the deal by Whop's own deal link or a payer
  tie (matchedBy not 'card'). A rule-2 card match (kind 'remainder', matchedBy 'card') IS a
  candidate, so Q23's day-30 upsell can be tied, and carries inDealLedger:{closer role, month}:
  [{paymentId, rail, usd, paidOn, checked bool, inDealLedger|null, closerPaidMonth|null,
    payer: null for a CSM}]
cockpit_csm_win_tie_propose(p jsonb) RETURNS jsonb                       -- authenticated (CSM or CEO)
  p = {requestId, winId, paymentId}; win stage 'signed' ('Mark it accepted first.'); payment among the
  candidates; a logged (unchecked) manual payment is accepted as a proposal but cannot be confirmed
  until checked. Event tie_proposed. -> 'Sent to the CEO to confirm.'
cockpit_ceo_win_tie_decide(p jsonb) RETURNS jsonb                        -- authenticated; CEO
  p = {proposalId, decision:'confirm'|'decline', reason?}
  confirm: payment checked ('This transfer is not checked yet. Check it first, then confirm the tie.');
  a payment in the deal ledger needs reason (3..300, 'This payment counts for the closer now. Say
  why it is the upsell's.'); a payment counted in an approved month's closer commission
  (cockpit_win_closer_paid not NULL) is refused: 'This payment was paid to the closer in {month}. It
  stays with the deal.' (the CEO can still type an entry outside the ledger with its reason, 4.9);
  inserts cockpit_payment_ties (payment_id, clickup_task_id = the win's card, win_id, note 'Upsell
  payment for {kind label}', set_by the CEO) through the same path as cockpit_ceo_payment_tie's insert
  (a payment already carrying a live tie: 'This payment is already tied. Clear that tie first.');
  the win -> paid; events tie_confirmed, paid. decline: reason required; event tie_declined.
cockpit_ceo_win_tie_clear(p jsonb) RETURNS jsonb                         -- authenticated; CEO
  p = {winId, reason}  reason 3..300. The only way a win tie is cleared (the ordinary untie refuses
  it, 2.2). Refused when a confirmed pay proposal of this win sits in an approved month: 'The CSM was
  paid for this upsell in {month}. It stays tied; add an adjustment in {next month} if it was wrong.'
  Otherwise: clears the tie (cleared_at, the same revision bump as untie), the win paid -> signed,
  event tie_cleared, and returns {ok, entries:[{entryId, month, person, part, amountUsd}]} listing
  every confirmed entry with reference win:{id} in an open month, for the CEO to remove or adjust by
  hand ('Tie cleared. {n} pay entries came from this win; check them on Team & payroll.'). The
  payment then falls back to the automatic rules.
cockpit_csm_win_invoice_link(p_win_id uuid, p_invoice_id text) RETURNS jsonb   -- authenticated
  the invoice on the same card, no win yet; event invoice_linked.
cockpit_ceo_pay_proposals(p_month date) RETURNS jsonb                    -- authenticated, STABLE; CEO
  -> {month, on, approved bool, rows:[{key, personId, person, partKey, partLabel, quantity|null,
      cashUsd|null, engagementMonth|null, client, clearedOn|null, postedOn|null, evidenceRef, proofUrl,
      amountUsd|null, state:'proposed'|'waiting'|'confirmed'|'declined', why|null, entryId|null}]}
cockpit_ceo_pay_proposal_decide(p jsonb) RETURNS jsonb                   -- authenticated; CEO
  p = {month, key, decision:'confirm'|'decline', personId?, reason?}  (4.9; a proposal whose month is
  approved is confirmed into the first open month, never refused)

-- i (client-tail)
cockpit_form_file_read(p_response_id uuid, p_field text) RETURNS jsonb   -- authenticated, STABLE
portal_form_file_slot(...), portal_form_token_file_slot(...) RETURNS jsonb   -- service_role (3.6)
cockpit_retire_items_read() RETURNS jsonb                                -- authenticated, STABLE; CEO or admin
  -> {items:[{id, kind, externalId, name, usedFor, ownerRole, replacement, wave, state, switchOffStep,
      offAt, quietSince, archiveFrom, archivedAt, note}]}
cockpit_client_lifecycle_confirm('reactivate', p jsonb) RETURNS jsonb    -- authenticated (4.12)

-- j (stage4)
cockpit_kickoff_prefill(p_task_id text) RETURNS jsonb                    -- authenticated, STABLE
  -> {live bool, why|null, client, answered:{at, byRole}|null, fields:{key: {value, source}},
      onboarding:{submittedAt}|null, card:{mrrUsd, status}}
cockpit_kickoff_submit(p_task_id text, p_answers jsonb, p_request_id uuid) RETURNS jsonb  -- authenticated
  Gate: CEO or a CSM allowed on the client. forms.stage4.kickoff true ('The kickoff opens here after
  its switch-on. Until then use the kickoff form as before.'), or the test card while the canary runs.
  One kickoff per card, counting every stored kickoff: cockpit_client_onboarding.forms.kickoff
  with any form_id (the 30 from tG7dnxBn included) or a kickoff response not withdrawn. A second
  needs p_answers.replaceReason (3..300) and then re-runs only the handoff comment ('A kickoff was
  sent for {client} on {date}. Say why you are sending it again.'); it never re-runs the status, the
  card fields, the tasks, the map or the phase 4 message.
  cockpit_kickoff_answers_check, then the response (form_key kickoff, version 2, source cockpit,
  state submitted), the read model (4.13), cockpit_form_stage4_plan(response, true).
  -> {ok, responseId, trail:[{step, state}]}
portal_form_onboarding_open(p_location_id, p_clickup_id, p_person, p_role) RETURNS jsonb   -- service_role
  workspace checks as every portal RPC (W34 3.3); onboarding live for the card
  (cockpit_form_client_live('onboarding') and forms.stage4.onboarding), else {live:false};
  an answered onboarding -> {live:true, answeredAt}, where answered = any stored onboarding answer
  for the card (cockpit_client_onboarding.forms.onboarding with any form_id, Typeform, legacy or
  native, or a cockpit_form_responses onboarding row not withdrawn) or a stored kickoff (the card is
  past onboarding); an open invite -> {live:true, inviteId};
  none -> cockpit_form_invite_issue_system(card, 'onboarding', '{portal}', context, 'portal') and its id.
  Admins and members both may answer (audience 'any').
```

### 3.4 The agent door (AG)

`supabase/functions/billing-agent/index.ts` (new, `verify_jwt` off): accepts `POST` only, body ≤ 32 KB,
header `Authorization: Bearer mak_<43 base64url chars>`; anything else 401 with no body detail. It
computes the sha256 of the key and calls `cockpit_billing_agent_write` or `_read` with the service key
through the existing `_shared` HTTP helpers (so every call lands in the health ledger as
`billing-agent:<op>`). It never logs the key, its hash or the body. Rate limit: 60 calls a minute per
key, counted in SQL from `cockpit_agent_calls` (`limited` → 429).

The door is public, so a refused key costs as little as it can (11.7, C7 and L4). A key the database
answers `This key is not known.` or `This key was revoked.` (401) gets no health receipt, is refused again
from memory with the same sentence for a minute without a database call, and never joins the keys seen
working (a revoked key loses its pass). Answers from memory spend nothing. Above 20 such database answers
a minute per instance, a key the instance has not seen work is checked against the key list
(`cockpit_agent_keys` `key_sha256, revoked_at` over REST with the service key, read at most once a minute
per instance, hashes only): a live key goes on to the database, a revoked one gets its sentence, any
other key 429 `Too many calls with keys this cockpit does not know.` A random-key flood therefore never
locks the real agent out of a fresh instance. In SQL a revoked key writes at most one `refused` call row a
minute (`cockpit_agent_door_open`), so a leaked key's flood adds no rows and no audit.

SQL (`g`): both functions first resolve `p_key_sha256` to an unrevoked `cockpit_agent_keys` row
(`This key is not known.` / `This key was revoked.`); the identity is that row's `agent`, never a
parameter. Both are `VOLATILE`. Every call writes one `cockpit_agent_calls` row, except a revoked key's
repeats within a minute of its last `refused` row. A repeated
`p_request_id` returns the first result and writes a `duplicate` row with `request_id` NULL and
`detail.firstCallId` (the unique index stays on first calls only).

| Op (`_write`) | Body | Effect | Replaces |
|---|---|---|---|
| `chase` | `{taskId, step, note}` | billing event `chase`, source `maher` | the agent's REST insert (176 live rows) |
| `invoice` | `{taskId, invoiceNo, amount, currency, dueOn, note}` | billing event `invoice`, source `maher` | the agent's REST insert (35 rows) |
| `payment` | `{taskId, paidOn, amount, currency, method:'bank_transfer'|'cheque'|'cash', reference, evidenceUrl, note}` | `cockpit_billing_inbox` row, source `maher`, `check_state` logged (ingest unchanged); a transfer needs `evidenceUrl` and `reference` | `log_payment.py`'s inbox write |
| `note` | `{taskId, text}` | billing event `note`, source `maher` (not queued: `maher` is not in the trigger) | |

The agent's other live event kinds (11.2-h) are history, not ops: its 4 `date` events are from
before W12 C1, which retired its `--next` date write (plan 5.3: "its `--next` write already went in
the C1 window"); a next payment date moves only through Confirm paid (4.6) or a person's billing
edit. Its 2 `payment` events are from before the inbox; a payment now goes through the `payment` op
into the inbox.

| What (`_read`) | Returns |
|---|---|
| `accounts` | billing sheet rows (`cockpit_billing_accounts` fields the agent uses today, no payer emails) |
| `ladder` | `billing.ladder` |
| `balances` | Pending payments parts per card (the shape of `cockpit_billing_balances_read`, CEO view without payer names) |
| `inbox` | the agent's own inbox rows of the last 60 days and their states |
| `chases` | the agent's own `chase` and `invoice` events of the last 60 days per card (`{taskId, kind, step, at}`), so the overdue steps keep their history |

No op writes ClickUp, LTV, a next payment date or a manual payment directly. D-AG reads the live
skill (`billing-agent` on the VPS: `SKILL.md`, `scripts/cockpit.py`, `log_payment.py`, `billing.py`)
and maps every Supabase REST call to an op or a read; a call with neither stops D-AG (the agent keeps
its key until it is mapped and the gap goes in the deploy log). It also lists every ClickUp API call
in the skill (`grep -n "api.clickup.com\|clickup" ` over the files, lines only): each ClickUp
**write** is removed (card writes go only through the rails) and the read-back counts zero write
calls; a ClickUp write that no rail op covers stops D-AG the same way. ClickUp reads may stay and are
listed in the deploy log.

`viktor-side-scripts/billing-agent/cockpit_agent.py` (new, stdlib only): `door(op, body)` and
`read(what, args)` posting to `${COCKPIT_URL}/functions/v1/billing-agent` with the key read by name
from `MAHARA_AGENT_KEY` (never printed, never in an argument), a request id per call, 15 s timeout, and
the server's sentence surfaced unchanged on refusal. It has a `doctor` command
(`python3 cockpit_agent.py doctor`: key present, door reachable, `read ladder` ok). It is copied into
the skill at D-AG; the skill's own `cockpit.py` writes are re-pointed to it there.

### 3.5 Billing kinds `win` and `reactivate` (`g`; W12 3.3 extended)

| Event (`kind`, `source`) | `detail` keys | Writes, in order | Comment |
|---|---|---|---|
| `win` csm/ceo | `win_id, kind, stage, won_on, proof_url?, quoted_usd?, agreement?, seat_role` | none | `WIN: {kind label} on {date}` / `Stage: {Logged | Offered at {usd} | Accepted}` / `Proof: {link or "on file in the cockpit"}` / `By: {seat role}` |
| `reactivate` csm/ceo | `return_on, status ('Active'|'Onboarding Booked'), departure_id, left_on, reason_was, type_was, next_date?, why, call_id?, seat_role` | `clientStatus` = status (option id from the field map), `churnDate` cleared, `churnReason` cleared, `churnType` cleared, `pausedOn` cleared, `resumeOn` cleared, then `date` = `next_date` when given | `REACTIVATED {return_on}` / `Back as: {status}` / `Churned {left_on}: {reason_was} ({type_was})` / `Why they came back: {why}` / `By: {seat role}` |
| `date` csm/ceo from a confirm | W12 keys plus `confirm_id, part, part_no, from_rule ('next_part'|'plus_month')` | `date` | `NEXT PAYMENT {from} → {to}` / `Because: {part words} confirmed paid on {date}` / `By: {seat role}` |
| `mrr` csm/ceo from the kickoff (stage4) | the live `mrr` keys `{from, to, reason_cat:'new_client', reason:'Kickoff: New MRR answer' (or 'Kickoff: paid in full, no monthly fee' when to = 0), effective: the kickoff's Kuwait day, win_id: null, seat_role}` | the live `mrr` write | the live `mrr` comment with the category label `New client` |
| `mrr` csm/ceo from Reactivate (client-tail) | `{from, to, reason_cat:'reactivation', reason:'Reactivated: ' \|\| left(why, 140), effective: return_on, win_id: the reactivation win, seat_role}` | the live `mrr` write | label `Reactivation` |

The two system categories are not added to the Set MRR sheet's five (`cockpit_billing_write` is not
replaced); money-rails adds only their labels to the comment and detail functions. The Set MRR rules
for zero and for a lower value (a written reason) are met by the act's own reason: the kickoff's
answer is the CSM's statement at the sale and Reactivate's `why` is required (10..500). No event is
written when the answer equals the card's MRR, or when it is 0 and the card's MRR is empty or 0.

`clickup-writeback/billing.ts`: a write with `value: null` on a `date` or `dropdown` field clears it
(read-back expects an empty value); if the live writer already does, the slice adds only the test.
No email and no name on the card.

### 3.6 Client form schema v1, wave 5 additions (`i`; the renderer, the SQL checker and the editor read it)

New field types, all still `"v": 1` (W34's V10 reserved `file` and `date`; ED refuses none of them
now):

```jsonc
{ "key": "receipt", "type": "file", "label": {...}, "hint": {...}, "required": true,
  "accept": ["image/jpeg","image/png","image/webp","image/heic","application/pdf"],   // subset of the bucket's list
  "maxBytes": 10485760 }                                                            // ≤ 10485760
{ "key": "paidOn", "type": "date", "label": {...}, "required": true,
  "notAfter": "today" | null, "notBeforeDays": 120 | null }                          // Kuwait days
{ "key": "amount", "type": "number", "label": {...}, "required": true,
  "min": 0.001, "max": 1000000, "decimals": 3 }                                      // decimals 0..3
{ "key": "website", "type": "text", "format": "plain" | "url" | "email" | "phone", ... }
{ "key": "aboutYou", "type": "heading", "label": {...}, "hint": {...} | null }        // display only, never answered
```

Answers: `file` → `{"path": "...", "mime": "...", "bytes": 12345, "sha256": "<64 hex>", "name": "<≤ 120 chars, display only>"}`;
`date` → `"YYYY-MM-DD"`; `number` → a JSON number; `heading` → never present (`unknown` if sent).
New codes: `file_missing` (required file absent, or the object is not in `storage.objects` for bucket
`cockpit-form-files` at that path, or the path is not a slot of this invite and field), `file_type`
(mime not in `accept`, or `storage.objects.metadata->>'mimetype'` differs), `file_size` (`bytes` over
`maxBytes` or differs from `metadata->>'size'`), `format` (url `^https?://[^\s]+\.[^\s]+$`, email
`^[^@\s]+@[^@\s]+\.[^@\s]+$`, phone `^\+?[0-9 ()-]{7,20}$`), and `range` for a date outside its window
or a number outside min/max/decimals. The portal mirror (`client-form-schema.ts`) maps each code to
its sentence (5.8, 5.10). The fixture `apps/media-buyer-cockpit/scripts/fixtures/client-form-answers.json`
gains rows for every new type and code (written by client-tail, copied byte for byte by portal-56 to
`tests/fixtures/client-form-answers.json`; D0 compares with `cmp`).

`cockpit_form_file_slots`: `id bigint identity`, `invite_id uuid NOT NULL REFERENCES cockpit_form_invites(id)`,
`field_key text NOT NULL`, `path text NOT NULL UNIQUE` = `forms/{invite_id}/{field_key}/{sha256}.{jpg|png|webp|heic|pdf}`,
`mime text NOT NULL`, `bytes bigint NOT NULL CHECK (bytes BETWEEN 1 AND 10485760)`, `sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$')`,
`made_at timestamptz NOT NULL DEFAULT now()`, `made_via text NOT NULL CHECK (made_via IN ('portal','token','canary'))`,
`used_by uuid REFERENCES cockpit_form_responses(id)`.

`portal_form_file_slot` / `portal_form_token_file_slot`: the same workspace or token checks as
`portal_form_get` / `portal_form_token_open` (an open, live invite of this card; the token path logs
the open and its rate limits exactly as W34 3.6); the field exists and is `file`; mime in `accept`;
`bytes ≤ maxBytes`; at most 5 slots for the invite and field (`You can replace the file 4 times. Ask
your account manager for a new link.`). Returns `{ok:true, path}`; the portal server then asks Storage
for a signed upload URL for exactly that path (service key, 10-minute expiry) and returns it to the
browser, which uploads straight to Storage (so a 10 MB file never passes through Vercel). A slot
answers `{ok:false, reason}` with the token reasons of W34 plus `not_file`, `type`, `size`, `slots`.

Bank receipt invites (`i`, `cockpit_form_invite_issue` with `p_origin = 'billing'`): the context is
`{part ('deposit'|'onboarding'|'later'|'all'|'payment'), partNo int, expectedAmount numeric > 0,
currency ('USD'|'KWD'), dueOn date|null, manualPaymentId text|null, dealResponseId text|null}`;
`bank_receipt` only with origin `billing` (`Ask for the receipt from Pending payments or Checks
waiting.`); a `manualPaymentId` must be a `logged` transfer on the same card with no receipt yet
(`This transfer already has its receipt.`); one open `bank_receipt` invite per card (`A receipt
request is already out to {client}, sent {date}. Withdraw it to send a new one.`).

### 3.7 The retire registry (`i`)

`cockpit_retire_items`: `id text PRIMARY KEY` (`make:<id>`, `typeform:<id>`, `webhook:<tag>`),
`kind text NOT NULL CHECK (kind IN ('make','typeform','webhook'))`, `external_id text NOT NULL`,
`name text NOT NULL` (≤ 160), `used_for text NOT NULL` (≤ 240), `owner_role text NOT NULL` (≤ 60),
`replacement text NOT NULL` (≤ 240), `wave text NOT NULL` (≤ 20),
`state text NOT NULL CHECK (state IN ('on','off','closed','removed','archived','kept'))`,
`switch_off_step text` (≤ 40, a deploy row id), `off_at timestamptz`, `quiet_since timestamptz`
(the later of `off_at` and the newest legacy answer or run seen at the last deploy read),
`archived_at timestamptz`, `backup_path text` (VPS path of the saved blueprint or definition),
`note text` (≤ 500), `updated_by text NOT NULL`, `updated_at timestamptz NOT NULL DEFAULT now()`.
Moves: `on → off|closed|removed|kept`, `off → archived` only when `quiet_since <= now() - 14 days`
(`{name} has not been quiet for 14 days yet. Archive it from {date}.`), `closed → archived` likewise
for a Typeform (archived = left closed and marked, never deleted), `kept` is final. Rollback moves:
`off|closed|removed → on`, only with `p_patch.note` (3..500) and `p_patch.step` (the deploy row id
of the rollback); `off_at` and `quiet_since` are cleared and the audit keeps the history. The view adds
`archive_from = quiet_since + 14 days` and `ready = state IN ('off','closed') AND archive_from <= now()`.

### 3.8 The relay outbox (`j`)

`cockpit_form_relay_outbox`: `id bigint identity`, `response_id uuid NOT NULL REFERENCES cockpit_form_responses(id)`,
`effect_key text NOT NULL CHECK (effect_key = 'github_dispatch')` (`j` also allowed `client_data_row`;
`20261102l` narrowed it, X34), `task_id text NOT NULL`, `payload jsonb NOT NULL` (≤ 16 KB; the dispatch
body of 4.14, never a phone or email beyond what Make sends today), `dedupe_key text NOT NULL UNIQUE`
(`relay:<response>:github_dispatch`), `state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','claimed','sent','failed','unknown','skipped'))`,
`claim uuid`, `claim_until timestamptz`, `attempts int NOT NULL DEFAULT 0 CHECK (attempts <= 3)`,
`result jsonb`, `updated_at`. `cockpit_form_relay_claim` claims queued rows (and `failed` under 3
attempts after 10 minutes) only while the effect's owner is `cockpit`; `_done` records `sent`,
`failed`, `unknown` (never retried: GitHub gave no clear answer, so the dispatch may have gone) or
`skipped` (the test card, or a row of any other effect key, which is sent nowhere).

### 3.9 Notice kinds (`g`)

| Kind | Channel | Text | Facts | Card needed |
|---|---|---|---|---|
| `win.logged` | #csm-announcements | `{client}: {kind label} logged by the {seat role}.` (upsell: `{client}: {offer} offered at {usd}.`; accepted: `{client} accepted the {offer}.`) | win id, kind, stage, usd | yes |
| `receipt.in` | #csm-general | `{client} sent a transfer receipt ({amount} {currency}, paid {date}). Check it in the cockpit.` | response id, amount, currency, day | yes |
| `client.reactivated` | #csm-announcements | `{client} is back: {status}. They left on {date}.` | event id, status, left on | yes |

No email, no answer text beyond the amounts, no link token.

### 3.10 Doors (`g`, `cockpit_form_doors()`)

Adds, each true only when its functions exist (`to_regprocedure`) and its condition holds:
`wins` (`cockpit_csm_win_log(jsonb)` and marker `wins`), `receipts` (`portal_form_file_slot(...)` and
`bank_receipt` in `forms.client.live`), `reactivate` (`cockpit_churn_departures.returned_on` column and
marker `reactivate`), `kickoff` (`cockpit_kickoff_submit(text,jsonb,uuid)` and `forms.stage4.kickoff`),
`agent` (`cockpit_agent_keys_read()` and marker `agent`), `ltv` (`cockpit_ltv_read()` and marker
`ltv`). Every existing flag byte for byte. The function also returns `why` per new flag:
`missing` (its functions are not there) or `off` (only its marker or switch is false). A door
whose flag is false makes no call and hides itself with `Opens after the next cockpit update.` when
`why` is `missing`, and with `Not switched on yet.` when `why` is `off` (the RPC refusals keep their
own sentences, such as `Log a win opens after its switch-on.`). The Money tab Apply is the one
inverse door: it shows while `ltv` is false (5.5).

---

## 4. The builds

### 4.1 Notices and billing kinds (money-rails)

Files: migration `g`; `supabase/functions/cockpit-notices/*` (3.9 texts, `NOTICE_KINDS`, doctor names
them); `apps/client-success-cockpit/src/lib/notices.ts`, `src/components/NoticesRouting.tsx` (labels and
blurbs, 5.12); `supabase/functions/clickup-writeback/billing.ts` (clear on null, test). The writes,
comments, details and canary of 3.5 in SQL. The trigger per 2.3.

### 4.2 The wins ledger and Log a win (wins-pay for SQL; cockpit-screens for screens)

1. Tables and RPCs per 2.4, 3.2, 3.3.
2. Proof rules per kind (3.1, 3.2) enforced in SQL with these sentences: `Add the review link or a
   screenshot link.`, `Add the video link.`, `Add the episode link.`, `Pick the referred client's signed
   deal.`, `Add the agreement link or tie a payment later.` (renewal and reactivation log without proof,
   then wait for pay), `Add the quoted price.`, `Say why the price is below the list price.`, `The win
   date is today or within the last 30 days.`
3. Review asks are never gated on NPS or happiness (`csmHotList.ts:17-19` untouched).
4. The 35 old Typeform wins (Q16): `scripts/dev/wins_backfill.py` reads the five forms' responses
   through the Typeform API on the VPS (read only, `TYPEFORM_API_TOKEN` by name), maps each to a
   `void` win with `source 'import'`, `imported_from`, `void_reason 'imported, pre-cockpit'`, matching
   the card by the hidden or typed ClickUp id when it is on the billing sheet, else by the typed
   business name against `cockpit_billing_accounts.client_name` with case and spacing folded
   (`lower(regexp_replace(btrim(x), '\s+', ' ', 'g'))`) and exactly one hit (`task_id` kept only when
   found; otherwise the win is skipped and counted as `no card`). It inserts through an owner-only
   `cockpit_csm_win_import(jsonb)` in `h`, which writes only the void win and one `imported` event: no
   billing event, no card comment, no `win.logged` notice and no form response (tested). `--dry`
   prints counts per form only (never names or answers). Expected counts 4, 8, 8, 12, 3 (11.2-k); a
   different count is reported, not forced.

### 4.3 Upsell stages and the back-end rule (wins-pay)

1. "Mark as offered" on a proposal (status `sent`, `link_copied` or `accepted`) calls
   `cockpit_csm_win_log` with `proposalId`; the quoted price defaults to `sent_price`'s total and the
   list price to `sent_list_price`. "Log a win" with an upsell kind and a proof link is the other door.
2. Accepted needs the agreement link (`cockpit_csm_win_stage` accept). A proposal marked `accepted`
   in Offer Studio with no signed win puts `Client accepted: send the agreement` on the CSM's Today.
3. "Invoice this" opens the CSM invoice desk prefilled (Ecom by default, Whop as backup, as today)
   and, once the invoice is created, calls `cockpit_csm_win_invoice_link`. When that invoice's rail
   payment appears, Today shows `Invoice paid: tie it to the {offer}` → `Tie the payment`.
4. Paid: the CSM proposes the tie (`cockpit_csm_win_tie_propose`), the CEO confirms
   (`cockpit_ceo_win_tie_decide`). Only a checked payment can be confirmed (E8).
5. **The back-end rule (Q23, MONEY-ATTRIBUTION rule 7, new):** a payment whose live tie has a
   `win_id` is `side = 'back_end'`, credited to the card's CSM, never written to
   `cockpit_deal_payments`, and never added to a deal's running contract total or its 120-day term
   cap, even inside the deal's term. Both copies change together: native
   `hermes/ceo-refresh/native/adapters/money.js` (`attributePayments`, the ties are read from the
   snapshot, `tie.win_id` is checked before rules 1 and 2) and Edge
   `supabase/functions/cockpit-ceo-api/finance/attribution.ts` (+ `finance/adapters/money.ts` when it
   carries ties). `apps/media-buyer-cockpit/scripts/money-attribution-parity.test.ts` gains: an upsell
   payment on day 30 of a deal's term is back end, does not reach the closer, the deal ledger or the
   contract total; the same payment without `win_id` stays front end (rule 2); a cleared win tie falls
   back to the automatic rules. A win tie is cleared only by `cockpit_ceo_win_tie_clear` (the ordinary
   `cockpit_ceo_payment_tie` and `_untie` refuse a row with a `win_id`, 2.2), and both the confirm and
   the clear refuse when the same cash was already paid in an approved month (to the closer, or to the
   CSM from this win), so no payment is paid twice over time.
6. **Attributed once:** one payment ties to one win at most (index of 2.4); a pay proposal key is per
   win, part and month, and the C7 rule (4.9) refuses a second entry with the same `win:` reference,
   part and month. Flat-amount wins are deduped too: one non-void referral win per referred deal, one
   non-void reactivation win per departure (and none logged by hand within 60 days of a Reactivate
   win), and a renewal within 30 days of another on the same card warns before it is stored (3.3).
7. A recurring win at `paid` proposes `Add {monthly} to MRR?` on the client page; the press opens the
   W12 "Set MRR" edit prefilled with reason `upsell` and `win_id` (the existing `mrr` kind and its
   `win_id?` detail key). Nothing writes MRR by itself.

### 4.4 One LTV writer (money-rails)

1. `cockpit_ltv_plan(p_today)` = the `ltv.preview` rule of `20260927h_cockpit_ceo_actions.sql:109-121`
   with one change: the tied sum counts only transactions whose `checked` is true
   (`(t->>'checked')::boolean IS TRUE`, W12 CK and `money.js:111`: a row without the field is never
   counted as checked). A tied transaction without the `checked` key makes the whole run refuse with
   `The money section has payments without their check state; refresh Money before LTV is written.`
   (11.2-j: today every transaction carries it). Guards become refusals for the whole run
   (`why` on every row and the run note): finance totals not reconciled, the money section missing or
   older than 24 hours, billing days stale. Eligible cards and the baseline are exactly the preview's.
2. Daily step, appended to `cockpit_billing_daily_run` after the late records and only when
   `billing.ltv.on`: for each `write` row, `|delta| ≤ maxDeltaUsd` → one billing event `ltv`, source
   `system`, `from_value` card, `to_value` target, detail `{sum, rows, as_of, baseline, baseline_day,
   checked_usd}`; `|delta| > maxDeltaUsd` → a `cockpit_ltv_held` row (no event) until the CEO's
   `cockpit_ltv_release`. A card that already has an undelivered `ltv` item is skipped that day. The
   run note gains `LTV: {n} written, {h} held for the CEO, {m} missing a baseline.`
3. Retire every other writer (C8): `supabase/functions/cockpit-media-api/ltv.ts` `prepareLtv` throws
   `Lifetime value is written by the cockpit every morning now. See the list on the Billing tab.` and
   `index.ts` stops calling `ltv.preview` for an apply (the operation stays in the allow-list so the old
   bundle gets the sentence, not a crash); the billing agent's `log_payment.py` LTV write is deleted
   **inside D-LTV, before `billing.ltv.on=true`** (a file-scoped VPS step: the skill folder backed up,
   the write removed, the change read back), so the agent never writes LTV at the moment a payment is
   logged while the morning writer runs; the portal's `src/lib/billing-ltv.ts` returns `'retired'`
   whatever the env (portal-56). Make: no scenario writes `11d70e58` in the 2026-10-25 inventory of
   202 blueprints (11.2-l). D-LTV's pre-check greps the saved blueprints of the active scenarios **and
   the live billing-agent skill** for `11d70e58` and for an LTV field write; any hit stops D-LTV.
4. Second source: `cockpit_ltv_read()` lists target, card and the tied rows; the guardian's
   `ltv-drift` compares the mirror's `ltv_field_usd` with the last delivered target two days later
   (a read-back of the write). The independent check is `ltv-second-source`: per card, the sum since
   `baseline_day` of checked `cockpit_manual_payments` whose `clickup_task_id` is the card plus rail
   payments (Whop, Tap, Ecom) carrying a live payment tie to the card, read straight from the rail and
   tie tables (not the money section); that sum is a floor, so it warns when it exceeds the plan's
   `checked_usd` by more than $1. The CEO Billing tab card states where the number comes from (5.5).

### 4.5 The billing agent's login (money-rails; the VPS swap is D-AG)

Per 2.3 and 3.4. The service_role grants on the billing tables stay (billing-sync, ingest and the
writer need them).

The agent's Supabase access today is `COCKPIT_SUPABASE_URL/KEY` in `/opt/data/bibi/api-keys.env`
(memory client-billing-sheet), and that file is **shared**: `hermes/client-messages/run.sh:9`,
`hermes/cockpit-ask-ai` (`SUPABASE_SERVICE_ROLE_KEY`, `askai.py`), `hermes/sales-desk` and the
launch scripts source it. Deleting the key there breaks other workers; leaving it means the agent can
still read the master key. So AG is done in two parts:

1. **D-AG0 (inventory, read only):** list every file the agent's Unix user and runtime can read that
   holds a Supabase key (`grep -l` of the key *names* `SUPABASE_SERVICE_ROLE_KEY`,
   `COCKPIT_SUPABASE_KEY`, `SUPABASE_KEY`, `SUPABASE_SERVICE_KEY` over its env files, the shared
   files it sources, its skill folder and its home; `sudo -u <agent user> test -r <path>` for each
   file found under other workers' folders), and the Unix user each worker runs as. Paths and names
   only in the deploy log, never values.
2. **Separation, only if possible:** the agent gets its own env file readable only by its user
   (`chmod 600`) holding `MAHARA_AGENT_KEY` and `COCKPIT_URL`, and no Supabase key; every file that
   holds a Supabase key and that other workers need is made unreadable to the agent (another user's
   file, or the other workers move to a file the agent cannot read, each worker's next run read
   back). This needs the agent to run as a Unix user (or a sandboxed runtime) of its own. **If the
   agent shares a Unix user with workers that need the service key, separation is not possible in
   this wave**: D-AG still moves every agent write to the door and removes the keys from the agent's
   own env and skill, the deploy log and the CEO card say plainly `AG is not achieved: the agent can
   still read the old key on the server.`, and section 10 carries the separate user as a systems step.

The read-back checks every path readable from the agent's runtime (the D-AG0 list run again as the
agent's user): zero files with a Supabase key name for "achieved", or the stated "not achieved" line.

### 4.6 Confirm paid moves the next payment date (money-rails)

1. In `cockpit_billing_balance_write('confirm')`, when `billing.confirm_date.on`, the part is `later`
   (a recurring month or the split's later payment), and the confirmed part's due date is within
   `windowDays` of the card's mirrored Next Payment Date: insert one billing event `date` (source
   `ceo`/`csm`) from the card's date to **the due date of the next unconfirmed later part** of the same
   deal, else **the card's date + 1 month** when the card's Payment Plan reads monthly, else no date
   (the result says `Next payment date stays {date}: there is no later payment on this plan. Set it by
   hand if they continue.`). Detail of 3.5; `confirm_id` on the event and `event_id` on the confirmation
   already exists.
2. Not the payment due on the card: no move, sentence `Next payment date stays {date}: this payment was
   not the one due on it.`
3. `withdraw` of a confirmation that moved the date: when the mirror still shows the moved date, insert
   the reverse `date` event (`from_rule 'withdraw'`); otherwise no reverse and `The card's next payment
   date was changed since; it stays {date}.`
4. One date write per save holds with W12's payment rule (5.3): a confirm never also queues a payment
   date.
5. `cockpit_billing_balances_read` adds `dateIfConfirmed` per part (the date the rule would write, or
   NULL with `dateWhy`), so the screen can say it before the press (5.6).
6. (Revision 2.) The server works the days out itself (`cockpit_billing_later_due`): with a launch day on
   record a later part n is due launch + n months (the card's date when the card moved it 1 to 21 days
   on); without one, the next part must sit 30 days a part after this one, less up to 21. The browser's
   `dueOn`, `nextPartNo` and `nextDueOn` are only an optimistic check: a mismatch refuses the whole confirm
   with `The payment plan changed since this page loaded. Reload the page and confirm again.` and writes
   nothing.

### 4.7 C7 switch-offs (deploy D-W, with wins-pay's backfill)

In the D-W hour: save the five Typeform definitions and webhook lists; close `ETEynRgb`, `bAmbMKM2`,
`cKItPZVI`, `VP3zmaj2`, `IVHO9BMC` (`is_public:false`); remove `WHTP4096883`, `WHTP4105426`,
`WHTP4105956`, `WHTP4108828`, `WHTP4112950` and the phoenix webhook on `bAmbMKM2` (read the lists
before and after); save the blueprints and switch off Make `9169735`, `9188441`, `9190294`,
`9195843`, `9205789` (read back `isActive=false`); freeze the sheet tab "04: Referrals, Upsells,
Reviews" (protect the range; the CEO's sheet, read back); enable `win.logged`; run
`wins_backfill.py` (`--dry`, then without). Each item's `cockpit_retire_items` row moves to
`closed`/`removed`/`off` with its backup path.

### 4.8 Readers of wins (wins-pay)

- `hermes/ceo-refresh/native/metrics.ts`: `clients.wins.reviews`, `.testimonials`, `.podcasts`,
  `.referrals`, `.renewals`, `.reactivations` (counts of non-void wins in the window by `won_on`),
  `money.upsells.offered`, `money.upsells.accepted` (counts **by event day in the window**: the
  `offered` event and the `accepted` event of non-void wins, so a win that later reached `paid` still
  counts as offered and accepted), `money.upsells.cash` (checked tied cash in the window by payment
  day), each with a source sentence; missing reads say why, never 0. `upsellRate` = accepted ÷
  offered, both by event day in the window, `not known` when offered is 0 (SOURCES.md, 6.4).
- `apps/media-buyer-cockpit/convex/ceo/metricRegistry.ts` and `src/pages/ceo/SOURCES.md` rows (6.4).
- Goal actuals (`googleReviews`, `referrals`, `testimonials`, `upsells` = offered + accepted,
  `upsellCash`, `upsellRate`) and the lock-in's "Upsells", "Upsells Cash", "Potential upsells / why we
  missed them" (voided upsells with reasons and proposals that ended `not_now`) read `cockpit_wins_v`
  through the CEO refresh's goal context (`metrics.ts` writes them); the screens (cockpit-screens)
  show them as measured beside any typed answer, the typed answer winning as today.
- `csmMoney.ts` (both apps, cockpit-screens): "From your wins" in place of the typed counts and the
  Typeform links.

### 4.9 Pay proposals and the C7 rule (wins-pay)

1. `cockpit_win_pay_rows(p_month)` derives proposals (person = `csm_person_id`):

| Win | Part key (CSM plan) | Proposed | Month | Waits when |
|---|---|---|---|---|
| review | `google_reviews` | quantity 1, `postedOn` = won_on, evidence = proof | won_on | never (proof required at log) |
| video_testimonial | `video_testimonials` | 1 | won_on | |
| podcast | `podcasts` | 1 | won_on | |
| referral | `referrals` | 1, `clearedOn` = first active `cockpit_deal_payments` day of the referred deal | that day | `The referred client has not paid yet.` |
| renewal / reactivation | `renewals` / `reactivations` | 1, `clearedOn` = won_on (agreement) or the tied payment day | that day | `No agreement link or tied payment yet.` |
| upsell, not recurring, paid | `upsells` | `cashUsd` = checked tied cash paid in the month, `engagementMonth` 1, `clearedOn` = first such day | each month with tied cash | `Cash not checked yet.` |
| upsell, recurring, paid | `recurring` | `cashUsd` = checked tied cash in the month, `engagementMonth` = months since the first tied payment + 1 | each month with tied cash | `Cash not checked yet.` |

   A part missing from the person's plan for that month → `waiting` with `{part} is not in the
   {role}'s plan for {month}.` Evidence reference `win:{id}`; proposal key
   `win:{id}:{part}:{YYYY-MM}`. Amounts are priced with the person's plan (the same `checkPlan` reading
   `cockpit_pay_compute` uses) and shown; the entry is what pays.
2. `cockpit_ceo_pay_proposal_decide`: `confirm` calls the entry save path with the proposal's fields
   (the CEO's own session, so `cockpit_ceo_pay_entry_save`'s gate and audit run), records the decision
   with `entry_id`; `decline` needs a reason. A proposal whose month is approved
   (`cockpit_pay_last_approved`) is not refused: the confirm writes the entry into the first open
   month after the last approved one, with the same `win:` evidence reference and the note `For
   {proposal month}: {part label}`, and answers `Added to {open month}: {proposal month} is
   approved.` The proposal key (`win:{id}:{part}:{YYYY-MM}` of the proposal month) and the decisions
   table keep it to one payment. `pay.proposals.on` false refuses with `Pay proposals open after their
   switch-on.`
3. **The C7 rule** (replaced `cockpit_ceo_pay_entry_save`, active only while `pay.proposals.on`): for
   the parts `google_reviews`, `video_testimonials`, `podcasts`, `referrals`, `renewals`,
   `reactivations`, `upsells`, `recurring`, an entry whose `evidenceRef` is not `win:<uuid>` needs
   `outsideLedger` (10..300 characters), stored as the entry note prefixed `Outside the wins ledger: `
   (`This part comes from the wins ledger. Confirm its proposal, or say why it is not in the ledger.`);
   for `upsells` and `recurring`, a second non-void entry with the same `win:` reference and part for
   the same proposal month (its own month, or the `For {month}` note of a carried confirm) is refused
   (`This win is already paid for {month}.`); a flat part (every other listed part) pays once per win,
   so a second live entry with the same `win:` reference and part is refused whatever its month (the
   same sentence), and so is an entry for a win whose voided twin (11.7, C3) is still paid
   (`Already paid on the win of {day} that was voided since.`). Adjustments and every other part are byte for byte as today. Nothing
   ever posts pay by itself (E12); `cockpit_pay_compute` is unchanged and reads the entries.
4. Closer commission stays measured from the deal ledger as today (MONEY-ATTRIBUTION rule 1); it is not
   a proposal, and the back-end rule keeps upsell cash out of it.

### 4.10 The bank receipt (client-tail for SQL and the staff file door; portal-56 for the page; cockpit-screens for the buttons)

1. Registry `bank_receipt` (5.8), audience `admin`, signer `typed`, 2 minutes. Its `amount` and
   `currency` are prefilled from the invite context (`expectedAmount`, `currency`) and stay editable.
2. `cockpit_form_issue_hook_bank_receipt(invite)`: the context rule of 3.6; nothing else.
3. `cockpit_form_hook_bank_receipt(response)`: when the invite's context has `manualPaymentId` →
   one `cockpit_payment_receipts` row (no inbox row, so the payment is never logged twice); else, when
   the card has exactly one `logged` transfer without a receipt in the same currency, its amount
   within 1% of the answer and its day within 3 days of `paidOn` (the same transfer logged by the
   agent or a CSM) → one `cockpit_payment_receipts` row against it; else →
   one `cockpit_billing_inbox` row (source `portal`, `method 'bank_transfer'`, amount, currency,
   `paid_on`, `reference`, `evidence_url = 'storage://cockpit-form-files/' || path`, `response_id`,
   status `pending`, `logged_by 'the client'`); ingest takes it in as `logged` (W12 CK, unchanged).
   A canary answer (invite origin `canary`) writes its inbox row with status `rejected` and
   `status_note 'Canary on the test card'`, so ingest never takes it in. When ingest later marks a
   portal row `duplicate` (an exact twin, W12 CK), the trigger of 2.5 attaches the receipt to that
   twin, so Checks waiting shows the twin with its receipt. A portal row that becomes its own logged
   payment while another logged transfer on the card is a near match (2 or more such rows within 3
   days and 1%) shows `May be the same transfer as {date} {amount}` in Checks waiting.
   Either way: notice `receipt.in` (dedupe `receipt:`||response), and the row appears in Checks waiting
   (`cockpit_manual_payments_to_check`, replaced) with `receipt` and a `View the receipt` link. The
   card is not changed (D11). It is not cash, LTV or pay until `cockpit_manual_payment_check` moves it
   to `checked` (unchanged W12 RPC). Once checked, a receipt whose invite context names a `later`
   part puts `Receipt checked: set the next payment date to {date} ({client})` (or `... set the next
   payment date ({client})` when 4.6's rule gives none) on the CSM's Today for 14 days, until a date event
   lands on the card; it opens the billing sheet, where the W12 date edit writes the one date (revision 2:
   Confirm paid refuses a transfer, so it cannot be the door; no new trigger; X29).
4. Staff view: `cockpit-forms-api` op `file.url` `{responseId, field}` → `cockpit_form_file_read`
   with the seat's token, then a 5-minute signed download URL from Storage with the service key; the
   URL is returned once and never logged (`supabase/functions/cockpit-forms-api/{door.ts,files.ts}`).
5. Pending payments: `Ask for the receipt` on a part (context `part`, `partNo`, `expectedAmount`,
   `currency`, `dueOn`, `dealResponseId`); Checks waiting: `Ask the client for the receipt` on a
   logged transfer without a receipt (context `manualPaymentId`). Both open W34's Send panel preset to
   the bank receipt with origin `billing`.
6. The date trigger (E20) is a Today band, not a schedule (X28): a `bank_transfer` part whose due day
   has passed with no rail or logged payment for it and no open receipt invite shows `Payment due
   {date}, no money in: ask for the receipt ({client})` → `Ask for the receipt`, skipping Paused and
   Stopped cards. Nothing is sent by itself.

### 4.11 The C9 retire list (client-tail; deploy D-C9)

The registry of 3.7 seeded from 11.3. The guardian's `retire-quiet` reports each item `ready` from
`archive_from`. D-C9 switches off and closes the C9 rows in one window (each backed up and read back)
and, on any later deploy day, archives the rows that are `ready`: Make scenarios move to the folder
"09 Archive" (`PATCH /scenarios/{id}` with the folder id, read back), Typeforms are marked archived in
the registry and stay closed, webhooks stay removed. Nothing is ever deleted. Before archiving, the
deploy re-reads the scenario's last execution (`GET /scenarios/{id}/logs?pg[limit]=1`) and the
forms-door last legacy answer; any run or legacy answer inside the 14 days moves `quiet_since` and
stops that item.

### 4.12 Reactivate (client-tail for SQL; cockpit-screens for the sheet)

1. `cockpit_client_lifecycle_confirm('reactivate', p)`: `p = {requestId, taskId, departureId,
   returnOn, status:'Active'|'Onboarding Booked', nextPaymentDate?, mrrUsd?, agreementUrl?, why,
   callId?}`. Gate: CEO or a CSM allowed on the client; marker `reactivate` true (else `Reactivate opens
   after its switch-on.`), except the test card.
2. Needs a confirmed departure without `returned_on` (`{client} is not marked as left. Nothing to
   reactivate.`). A card whose mirror says `Stopped` but that has no confirmed departure (the 21 cards
   of section 10) is refused with the next step: `{client} has no confirmed churn. Confirm the churn
   first with Client is leaving, then reopen.` (X30); `departureId` is always required. `returnOn` on or after `left_on` and not
   after today + 14 (`The return date is on or after the day they left, and within 14 days from now.`);
   `why` 10..500 (`Say why they came back in 10 to 500 characters.`).
3. Writes, in one transaction: billing event `reactivate` (3.5; card writes held until D-RA), the
   departure's `returned_on`, `return_event_id`, `returned_by`; an `mrr` event when `mrrUsd` differs
   from the card (detail of 3.5, `reason_cat 'reactivation'`); a `reactivation` win (`source
   'reactivate'`, stage `logged`, `departure_id`, `agreement_url` when given; pay waits for proof per
   4.9; the unique index of 2.4 allows one per departure); notice `client.reactivated` (dedupe
   `reactivate:`||event); a `cockpit_form_responses` row `reactivate` (confirmed, cockpit). The
   departure is never removed: the churn of the month it left still counts (`clients.churn.*`,
   pay retention bands, the lock-in).
4. `cockpit_client_lifecycle_v` gains state `returned` after a returned departure; `cockpit_form_card_allows`
   treats a returned departure as closed; `cockpit_csm_churn_read` shows `Back since {date}`.
5. Today offers `Open the relaunch ticket` (the W12 prefilled request form, type `client_relaunch`,
   requester the presser) on the reactivated client for 7 days. The system never opens it.

### 4.13 Stage 4: the kickoff, native (stage4 for SQL and workers; cockpit-screens for the sheet)

1. **Fields** (version 2, `{lives:'cockpit'}`): the answers of `tG7dnxBn` (11.2-o) in the
   Typeform's order, each with its `typeformRef` and title (`cockpit_form_stage4_fields('kickoff')`: 41 in
   `j`, 46 since `20261102m` adds the five follow-ups Make 12 [11] prints and makes Post call form filled
   a Yes or No choice, 2.9), plus **New MRR** (`newMrrUsd`, number ≥ 0,
   required, label `New MRR (USD a month)`, hint `What this client pays us each month from now. 0 if
   they paid in full with no monthly fee.`). Prefill (`cockpit_kickoff_prefill`): the 23 hidden fields
   the cockpit fills today (`apps/client-success-cockpit/src/forms/prefill.ts`, from the onboarding
   answers and the card), the card's MRR for New MRR, each with its source chip. Since `20261102m` the
   hidden values are what Make 13 [29]'s Kickoff Form Link carries for the card's onboarding answer
   (`cockpit_form_stage4_hidden`): as stored, untrimmed, the appointment types joined with `,` as ticked,
   a revenue of 0 empty, and no business name taken from the card.
2. **Submit** (`cockpit_kickoff_submit`) then **the read model**: `cockpit_client_onboarding.forms.kickoff`
   = `{form_id:'native', response_id, answers:[{ref, title, value}] (Typeform shape, by `typeformRef`; a
   list in the order it was ticked since `20261102m`),
   payment (the "Payment Amount" `75e97e7d` value), recording (`b5578678`), submitted_at}`, so
   `growth.js`, Pending payments and the Blueprint prefill (`20261024a:602`) read it unchanged.
   `growth.js` drops only `KICKOFF_FORM` from its filter (`form_id IN ('tG7dnxBn','native')`).
3. **Effects** (`cockpit_form_stage4_plan`), the Make 12 parity table (8925654, 11.2-p):

| Make module | Effect key | Delivery | Native write | Intended difference |
|---|---|---|---|---|
| [11] handoff comment | `handoff_comment` | `clickup_queue` (kind `form`) | Make 12 [11]'s text, built in SQL (`cockpit_form_stage4_handoff_text`, 2.9): its 110 lines, `Not provided` for an empty hidden value or answer, `Yes` or `No` lines by `switch` (`Not provided` for any other answer), Payment Amount 0 `Not provided`, lists as ticked, hidden values from Make 13 [29]'s link | none: byte for byte (X37; the parity run compares the bytes, 4.15.1). ClickUp holds it followed by the writer's ref line, which cannot match (11.9) |
| [20] native status | `native_status` | `clickup_queue` | task status `IN PROGRESS` | none |
| [21] card fields | `card_fields` | `clickup_queue` | Client Status = Brand Blueprint Booked (option by id from the field map); the nine dropdowns by `cockpit_form_option_maps`, Service Advertised `bab9a58b` being the option ticked first (Make's `switch(first(…))`) and nothing when that one is not an option (`20261102m`); 🧬 Brand Blueprint Form Link `1b7a4a74` = the cockpit Blueprint link | the Blueprint link points at the cockpit Blueprint (PV's pass condition), not `oYZKtogO` |
| [17][18] Technical Onboarding task + comment, [22][23] Creative Onboarding task + comment | `onboarding_tasks` | `sql` (registry delivery) | a request: new type `client_onboarding`, two targets: Operations / Tech `901816723190` template `t-86ex8x9xw`, Media/Creative `901818016338` template `t-86eyu1w3d`, through `cockpit_request_create_system`, requester the submitting CSM; each task made from its template, then the whole handoff (the same bytes as `handoff_comment`) posted once on it as a comment: the plan's `comment_text`, kept on `cockpit_requests.task_comment` and in each part's queue payload as `taskComment` (`20261102m`), never through the details, which stop at 4,000 characters while real handoffs reach 4,656. (This row said "the handoff text as the task description" until 11.9: Make's [17] and [22] write no description, and [18] and [23] post comments) | one task each per card (Make doubles them on a second submit; the per-card dedupe of 2.6). **Open:** the request writer has no step that posts `taskComment`; until it does, the plan also keeps `l`'s details, so each task's description carries the handoff's first 4,000 characters, which Make does not write (11.9). The task name and what the request path adds to a task wait on the CEO (11.9, section 10) |
| [26][27] Onboarding Map phase 4 | `map_phase4` | `clickup_queue` | `51f49cb1` = `onboarding.map_urls.4` | none |
| [24] Client Data search (`google-sheets:filterRows` on column C, read at D-S4.0: no write), [28] wait, [25] phase 4 WhatsApp | `phase4_whatsapp` | `client_message` kind `phase4` | a draft with `stage4.messages.phase4`: Make's text with `{map_link}` (filled by the SQL) and `{content_folder}` (kept in the approved text; `hermes/client-messages` puts in the card's Client Data column H link at send, X35), approved by the CSM | waits for the CSM's approval (2b rule) instead of 30–120 s; skipped with a reason when Client Data has no group, as Make's filter; refused with a sentence to add the Google Drive Link in Client Data column H when the card's link is missing or not a link, where Make sent a blank line |
| (none) | `kickoff_notice` | `slack_notice` | the Stage 1 kickoff notice, already cockpit-owned | none |
| (none) | `new_mrr` | `sql` | billing event `mrr` (source csm, detail of 3.5, `reason_cat 'new_client'`) when the answer differs from the card's MRR | new (Q21) |
| (Make `8979157` [45], at the sale) | — | Make edit at D-S4K | [45]'s Kickoff Form Link `87d7d889` repointed from the `tG7dnxBn` link to the cockpit kickoff link `https://cockpit.maharamedia.com/client-success/clients/{task}?form=kickoff` (blueprint saved, only that value changed, diff read back) | new cards never get a link to the closed Typeform |

   Owners stay `make` for every row until `cockpit_form_stage4_go_live('kickoff', true)` writes the
   version-2 array (4.15.2) in one statement; until then the plan runs only for the test card (canary)
   and for `cockpit_form_parity_plan`.
4. **The writer:** `supabase/functions/clickup-writeback/forms.ts` learns the effect keys
   `handoff_comment`, `native_status`, `card_fields`, `map_phase4` (kickoff) and
   `profile_fields`, `raw_answers_comment`, `map_phase3` (onboarding), each read back; `run.ts` adds
   `CLICKUP_WRITEBACK_FORMS_KEYS` (comma list of form keys, default `checkin`; a `form` item of another
   key stays `dry_run` with `Held: {form} card writes are not switched on.`). The check-in path is byte
   for byte. **The map never moves back:** before writing `map_phase3` or `map_phase4`, `forms.ts`
   reads the card's `51f49cb1`, maps it to a phase through `onboarding.map_urls` and skips with
   `kept: the map is already at phase {n}` when that phase is the target or later (read back as kept).

### 4.14 Stage 4: client onboarding, native (stage4 for SQL and workers; portal-56 for the page)

1. **Schema** (version 2, client schema v1, 5.9): the 33 questions of `KFRCXPFx` (11.2-o) in the
   Typeform's order with their existing wording (the stored `answers.fields[].title`; the missing
   language drafted under the voice skill and listed in the slice report, then shown to the CEO in
   the forms editor before D-S4O, 1.3), `heading` items for its three screens, prefill context from
   the New Client Form answers the cockpit stores (`cockpit_form_responses` `new_client`: business
   name, the closer's notes) and the card. **Branching ("onsite logic", plan 5.16):** the builder
   derives which questions are conditional from the 46 stored answers (a question absent from some
   answers) and expresses each as schema v1's single-equality `showIf`; a test asserts the renderer
   and the SQL checker hide the same fields. D-S4.0 reads the saved definition's `logic` and stops if
   any jump is not a single equality on an earlier field (the schema is then extended on the branch
   first).
2. **The portal path:** Getting started shows "Your onboarding form" when
   `portal_form_onboarding_open` answers `live`; the form renders in `FormRenderer` with the normal
   invite RPCs; a locked workspace can open it (W34 rule). The Typeform embed (`PersonalForm.tsx`)
   shows only while not live. A client without portal access gets the link from the CSM's Send panel
   (copied into the group by the CSM; form invites are not on WhatsApp yet, memory forms-waves-3-4-live), or answers the
   Typeform link Make `8979157` [40] still sends at signing: after go-live that delivery feeds the same
   native planner through `cockpit_form_onboarding_typeform` (X26), so both doors run the same
   effects once per card.
3. **Effects**, the Make 13 parity table (8922994, 11.2-p):

| Make module | Effect key | Delivery | Native write | Intended difference |
|---|---|---|---|---|
| [25] GitHub dispatch `market_intel` | `github_dispatch` | `relay` | the same `repository_dispatch` (owner, repo, event type and payload keys read from the saved blueprint at D-S4.0, written into `~/.forms-relay/config.env` at D-S4F); the client name is the typed Business Name answer (`514bfd3f`) exactly as typed, empty when there is none, and the id is the card (`20261102m`; the payload key the relay reads stays `client`) | none, except a name holding a double quote, a backslash or a line break: the relay sends it escaped, where Make's [25] pastes it into its JSON unescaped and fails (11.9) |
| [29] Client Profile + Kickoff Form Link | `profile_fields` | `clickup_queue` | `7755485f` = Make 13 [29]'s text (`cockpit_form_stage4_profile_text`, 2.9): seven labels, each kept when its answer is empty, a revenue of 0 blank, cut at 5,000 characters as `l` cut it; `87d7d889` = the cockpit kickoff link `https://cockpit.maharamedia.com/client-success/clients/{task}?form=kickoff` | the kickoff link opens the cockpit sheet, not a prefilled Typeform. The profile text: none, byte for byte (X37), up to 5,000 characters. **Open:** `clickup-writeback` refuses a text value over 5,000 characters and that refusal would fail the whole row, the kickoff link with it, so the builder cuts the profile there until the writer takes longer text (11.9) |
| [41][42][47] raw answers comment | `raw_answers_comment` | `clickup_queue` | Make 13's text (`cockpit_form_stage4_raw_answers_text`, 2.9): `**Raw Onboarding Form Answers**`, then each answered question in `KFRCXPFx`'s order as `**<its full title>**`, its answer and a blank line, a revenue of 0 blank; the full titles from `onboarding.raw_titles`, filled at D-S4F. While the setting is empty, malformed or has no title for an answered question, the effect fails with its sentence and nothing is posted | none: byte for byte (X37) |
| [31] Client Data search (`google-sheets:filterRows` on column C: the card's row, where the phase 3 group is; read at D-S4.0) | none (it gates [49] to [48]: `map_phase3` and `phase3_whatsapp` run once per row it finds, 11.8) | — | nothing: Make writes no Client Data row, and `hermes/client-messages` reads the group (column F) and the content folder (column H) from the card's row itself | none; the `client_data_row` effect `j` planned (it appended a row when the card had none) is removed by `20261102l` (X34) |
| [49][50] Onboarding Map phase 3 | `map_phase3` | `clickup_queue` | `51f49cb1` = `onboarding.map_urls.3`, never moving the map back (4.13.4) | none, except a card already at phase 3 or later is kept |
| [51] wait, [48] phase 3 WhatsApp | `phase3_whatsapp` | `client_message` kind `phase3` | a draft with `stage4.messages.phase3` (`{map_link}` and `{content_folder}` as in phase 4, X35), CSM approval | waits for approval; skipped with a reason when Client Data has no group; refused with a sentence when the card's Google Drive Link is missing or not a link |
| route 2 [46] Brand DNA task | `brand_dna_task` | `sql` | a request: new type `brand_dna`, Media/Creative `901818016338`, no template and the fixed assignee, as Make 13 [46] (`createTaskInList`, read at D-S4.0), via `cockpit_request_create_system`; no details, as [46] writes no description (`20261102m`; `l` put the raw answers text there) | none, except one per card (2.6). The task name and what the request path adds to a task wait on the CEO (11.9, section 10) |
| (cockpit) read model | `read_model` | `sql` | `forms.onboarding` Typeform-shaped, `form_id 'native'`, each list in the order it was ticked since `20261102m` (`cockpit_form_record_make` keeps refusing to overwrite a newer row) | none |
| (portal) gate evidence | (not a registry effect) | portal | `portal_form_status` returns the native answer, so `onboarding-cockpit-evidence.ts` completes the `form` step (W34 4.7) | none |

   **Once per card.** The hook and the planner run every effect at most once per card, whichever
   door the answer came through: a card that already has any stored onboarding answer or kickoff is
   refused an invite (2.2 card allows), shown `answeredAt` in the portal (3.3), and a later Typeform
   delivery for it is stored `legacy` with no effects. PGlite cases cover a card with a legacy
   Typeform answer (no invite, no effects) and a card at map phase 5 (map kept).

4. **The relay** (`hermes/forms-relay`, new, VPS, native release): claims `cockpit_form_relay_outbox`
   rows and sends the GitHub dispatch through the token read by name (`GITHUB_DISPATCH_TOKEN`), records
   `sent`, `failed` or `unknown`; the test card, or a row of any other effect key, is `skipped` and sent
   nowhere. It writes nothing to Client Data and holds no Google key (X34): `config.env` needs only
   `DISPATCH_OWNER`, `DISPATCH_REPO`, `DISPATCH_EVENT` (default `market_intel`), `DISPATCH_NAME_KEY` and
   `DISPATCH_ID_KEY`, and old `CLIENT_DATA_*` lines are ignored. `doctor` checks the token and the
   config; cron under `flock` every 2 minutes; `FORMS_RELAY_APPLY=false` prints what it would send
   (counts and keys, never values); a RUNBOOK row; a health-ledger line per run, and the ledger lets
   only GitHub calls out.

### 4.15 Parity proof and the go-live machinery (stage4)

1. `scripts/dev/make_parity.py` (runs on the VPS, read only; rebuilt after D-S4.0, X36). Make's public
   API returns no module bundles (`GET /scenarios/{id}/logs/{id}` is a summary, `/executions/{id}` only
   a status), so the script never calls Make. Its four parts:
   - **Inputs: the answers the cockpit stored.** Kickoff: the `cockpit_client_onboarding` `forms.kickoff`
     rows with `form_id` `tG7dnxBn` (7 live), linked to their `cockpit_form_responses` pointer rows.
     Onboarding: the `cockpit_form_responses` `onboarding` rows (`answers.fields`), plus any read-model
     entry they lack. Newest first; `kickoff --last N` (default 7) and `onboarding --last N` (default 5),
     N from 1 to 50.
   - **Make's side: an evaluator of the saved blueprints.** It runs the IML the two blueprints use on
     those answers: `{{…}}` text and typed expressions; paths such as `1.hidden.x` and
     `24.mappable_answers.<ref>`; `ifempty`, `get`, `switch`, `join`, `flatten`, `add`,
     `first`, `encodeURL`, `floor`; `emptyarray`, `random`, `true`, `false`, `null`; route filters and
     routers; Make 13's [41]/[42] iterator and aggregator. The trigger is found by module type (Make 12
     [1], Make 13 [24]). Each module's input comes out in the `{id: {input, output, module}}` shape the
     comparisons read. Outputs that later modules read are placeholders: the card's map link
     `{map_link}`, Client Data's group `{wa_group}` and content folder `{content_folder}`, a new task's id
     `{task:N}`. A function, name, filter or module it does not know stops the run with `the evaluator
     does not know …`; it never guesses. The kickoff's hidden values are what Make 13 [29]'s Kickoff Form
     Link prefilled from the card's stored onboarding answers, or, since 2026-10-22, what the cockpit's
     own kickoff link sent; the script keeps the one whose handoff ClickUp holds and prints `hidden
     values from the cockpit's kickoff link, not Make 13 [29]'s` when it is the cockpit's. Blueprints and
     definitions are read from the saved files, never from Make: `--blueprint-dir` (default
     `/home/hermes/make-backups`) and `--typeform-dir` (default `/home/hermes/typeform-backups`), named
     `{id}-before-s40-20261102s40.json`.
   - **The cockpit's side:** `cockpit_form_parity_plan(form, input)` on the same answers and hidden
     values (`STABLE`, writes nothing). The client is the billing account's name, then the response's,
     then the read model's, as `cockpit_form_stage4_input` takes it (it fills a phase text's `{client}`;
     since `20261102m` the dispatch sends the typed Business Name instead, X37). `oracle(form, saved, rec,
     readmodel, responses, names, source)` gives one stored answer's two inputs with no network (what the
     parity plan is sent, and Make's evaluated modules), and `plan_lines()` and `summary()` print a run as
     the VPS does, so a branch's SQL can be compared off the VPS (4.15.5).
   - **Fidelity: the evaluator proven on real data.** The evaluated Make 12 [11] handoff comment
     (kickoff) or Make 13 [47] raw answers comment (onboarding) must equal a comment ClickUp holds on the
     card (`GET /api/v2/task/{id}/comment`, read only, paged back to an hour before the answer), with
     whitespace folded and ClickUp's markdown marks and rule lines ignored. A difference prints the line
     number, a fixed label and the line counts, never a value. Each ClickUp read has an intent receipt
     before it and a response receipt after it in `cockpit_csm_provider_health` (provider `clickup`,
     `run_key` `make-parity:{uuid}`); a read whose intent receipt cannot be saved is not made.

   It prints a header line for each Client Data module (`kickoff [24] search`, `onboarding [31] search`,
   or `… writes: {columns}`, which stops Stage 4 until that write is its own effect), then per run one
   line per effect and one for fidelity. Verdicts: `equal`; `differs: {field}`; `intended: {difference
   of 4.13/4.14}`; `setting missing` (a phase text while `stage4.messages` has none: its own verdict,
   neither a pass nor a difference). A text Make writes (the handoff, the same handoff on each onboarding
   task, the raw answers comment, the Client Profile, a phase text) is `equal` only byte for byte (X37);
   `differs: text, whitespace only` names a difference of spaces or new lines alone. `onboarding_tasks`
   compares the plan's `comment_text` with [18] and [23] byte for byte; a plan with only details reads
   `differs: Make posts the handoff on each task as a comment, the cockpit only in the task description`.
   It also reads `differs: nothing posts comment_text on the two tasks` while `TASK_COMMENT_STEP` is
   `None` (the request writer's step that posts `taskComment`; `test_make_parity.py` fails while it and
   `REQUEST_STEPS` in `clickup-writeback/requests.ts` disagree), and `onboarding_tasks` and `brand_dna_task`
   read `differs: the cockpit writes a task description Make does not` for a plan with details (Make 12
   [17], [22] and Make 13 [46] write none). Service Advertised has no intended line: a service the cockpit
   writes where Make 12 [21] writes none differs.
   Fidelity keeps folding whitespace, because ClickUp rewrites a comment it stores. Phase texts compare as
   templates, `{map_link}` and `{content_folder}` intact. The last line is `PASS`, `FAIL` (any `differs`, fidelity included) or
   `NOT PROVEN` (no difference, but a setting missing), with the run and difference counts, and names
   the phase text that was not compared. Exit 0 only on `PASS`.
   Pass = `PASS` for both forms: every effect `equal` or `intended` and fidelity `equal` on every run.
   It prints ids, field ids, effect keys, run numbers and verdicts only: never a name, an answer, a
   phone number, a token or a key. Tests: `python3 scripts/dev/test_make_parity.py` (30 run, 1 skipped)
   on trimmed copies of the saved files in `scripts/dev/fixtures/make-parity/` (synthetic answers; the
   token header dropped, the repository and the fixed assignee replaced); with
   `MAKE_PARITY_SAVED_DIR` pointing at the saved files, the skipped test proves the fixtures equal them,
   trimmed.
2. `cockpit_form_stage4_go_live(form, on, actor)`: on → registry provider `native`, version 2, the
   registry's `effects` replaced by `cockpit_form_stage4_effects(form, 2)`, `forms.stage4.<form>` true
   (and `onboarding` added to `forms.client.live` through `cockpit_form_client_go_live`); off → back
   to `typeform`, version 1, `effects` = `cockpit_form_stage4_effects(form, 1)` (the live arrays of
   11.2-d), the flag false. It refuses when the current `effects` equal neither array (drift). One
   audit row. It writes the arrays directly (owner only), because `cockpit_form_registry_set` refuses
   key changes (20261101l:1124). The version-2 arrays (`{key, delivery, owner, label}`):

   kickoff: `handoff_comment` clickup_queue cockpit "Handoff comment"; `native_status` clickup_queue
   cockpit "Task status In progress"; `card_fields` clickup_queue cockpit "Card fields";
   `onboarding_tasks` sql cockpit "Tech and creative onboarding tasks"; `map_phase4` clickup_queue
   cockpit "Map phase 4"; `phase4_whatsapp` client_message cockpit "Phase 4 WhatsApp";
   `kickoff_notice` slack_notice cockpit "Kickoff notice"; `new_mrr` sql cockpit "New MRR";
   `recap` client_message **shadow** "Recap" (Q22: recaps stay off; never `cockpit`).

   onboarding: `profile_fields` clickup_queue cockpit "Client Profile and kickoff link";
   `raw_answers_comment` clickup_queue cockpit "Raw answers comment"; `map_phase3` clickup_queue
   cockpit "Map phase 3"; `github_dispatch` relay cockpit "Market intel dispatch"; `phase3_whatsapp`
   client_message cockpit "Phase 3 WhatsApp"; `brand_dna_task` sql cockpit "Brand DNA task";
   `read_model` sql cockpit "Answers in the client record".

   `20261102l` took `client_data_row` out of both onboarding arrays (version 1 too: Make's entry named
   a write Make never made; its [31] search writes nothing), so "off" restores 11.2-d's
   onboarding array without it (2.8, X34).

   The test asserts both arrays exactly in both directions, that `recap` is never `cockpit`, and that
   the replaced `cockpit_forms_effects_valid` accepts `relay` (and still refuses any other new
   delivery).
3. After go-live, forms-door stores any Typeform delivery for that form as `legacy` with
   `legacy.received` (the replaced `cockpit_form_record_legacy`), so an old link's answer is kept.
4. Recorded inputs for history and parity: the 30 `forms.kickoff` read-model rows (full answers) and
   the 46 stored onboarding answers are the cockpit-side records; the 8 kickoff rows in
   `cockpit_form_responses` stay pointers (the responses guard keeps a submitted row's answers fixed,
   so nothing is rewritten). `scripts/dev/forms_legacy_backfill.py kickoff --count` (new mode) prints
   only the counts of both sources so D-S4.0 knows the inputs exist; it writes nothing.
5. **The oracle run before a deploy** (the Mac, read only; X37). A private harness, kept outside the
   repo in the session's private scratch folder (folder mode 700, files 600) and never committed, proves
   a branch's SQL on the real stored answers before D-S4F applies anything. It reads, with SELECTs
   through `scripts/dev/forms-deploy/wsql.py` only, the stored kickoff and onboarding answers, the card
   names, the settings, the option maps, the request templates and the members it needs; a temp file the
   connector writes for a large result is moved into that folder. It loads the branch's chain into PGlite
   exactly as `stage4-native-supabase.test.ts` does, then `20261102m` when the file exists; fills what
   D-S4F fills (`onboarding.map_urls` and the option maps as live holds them, `stage4.messages` from the
   saved texts, `onboarding.raw_titles` from `stage4-raw-titles.json`, the `client_onboarding` and
   `brand_dna` request types through `cockpit_request_type_add`; the relay's settings are read from Make
   13 [25] in memory and never written); then calls `cockpit_form_parity_plan` on every stored answer and
   judges it against `make_parity.py`'s `oracle()` with the script's own `plan_lines()` and `summary()`.
   The kickoff runs twice: hidden values from Make 13 [29]'s link, and through the cockpit's own pipeline
   (`cockpit_form_stage4_hidden` on the card). Whether the request writer posts the task comment is
   `make_parity.py`'s own `onboarding_tasks` verdict (`TASK_COMMENT_STEP`, 4.15.1); a last private line per
   kickoff, `onboarding_tasks_runner`, says only whether the branch's effects runner hands `comment_text`
   to the request. The source of the hidden
   values goes by date offline (no ClickUp read: Make 13 [29]'s link before 2026-10-22, the cockpit's link
   from then), so its fidelity line reads `not read offline` and is not counted. It prints ids, effect keys,
   run numbers and verdicts only;
   the answers stay in the private folder. The VPS run (D-S4F) stays the proof of record, because only it
   reads ClickUp for fidelity.

---

## 5. The screens: design plans and copy

### 5.0 The two design plans (written before any code; Hallmark component scope)

**Cockpit (Log a win, client page Wins, Offer Studio stage controls, tie dialogs, CEO pay proposals,
LTV card, agent login card, Pending payments and Checks waiting additions, Reactivate, the kickoff
sheet, Retired forms).** Subject: the money a client success manager earns the company after the sale,
and the proof behind it. Audience: the CSM and the CEO, at a desk or on the phone app. Job: log a win
with its proof in under a minute, see where each upsell stands, and let the CEO turn proven wins into
pay with one press. Tokens are the cockpit's own (no second palette): `--mahara-teal` `#00cfc8` for
the one primary action and done states, `--deep-space` for ink on teal, the app's `--muted`,
`--border`, `--card`, amber (`--warning`) for waiting, the app's destructive red only for Void and
Revoke. Type: Geist for text, Geist Mono for money, dates and stage names; client names in `<bdi>`.
Layout: the CEO kit (`SectionCard`, `StatTile`, `StatusChip`, `EmptyState`, `format.ts`); sheets are
FormSheet (right sheet `min(560px, 100vw)` on desktop, bottom sheet under `md`). **Signature element:
the win ribbon.** Each win is one row with a thin horizontal track in Geist Mono: `Offered → Accepted →
Paid → Pay` for an upsell, `Logged → Pay` for the rest; each stop teal with its date when done, amber
with its waiting sentence when waiting (`Cash not checked yet`), a hollow ring when not yet; the money
sits at the right end in Geist Mono (`$1,500 tied · $150 proposed`). Voided rows cut the track with a
short muted dash and the reason. Motion only the stop filling (150 ms, off under reduced motion). No
italic headings, no invented numbers: a missing amount reads `not known`, never `$0`.

**Portal (the bank receipt form and its file field, the date and number fields, the native onboarding
form in Getting started).** Subject: a business owner in the Gulf on a phone sending a receipt or
telling us about their business. Audience: the client's admin (receipt) and anyone on the workspace
(onboarding); by link, the person in the WhatsApp group. Job: send the receipt in a minute; finish the
onboarding before the call, in more than one sitting if needed. Tokens are the portal's `globals.css`
(W34 5.0, unchanged). **Signature element: the receipt tile.** The file field is one tile, 96px tall,
dashed `--line` border when empty with the line `Add the receipt` and the camera and file icons; once
uploaded it fills `--teal-soft` with a thumbnail (image) or a PDF badge, the file name and size in
Arabic-Indic digits, a small teal check, and `Replace`; uploading shows a thin teal progress bar along
the tile's bottom edge. Errors sit under the tile in `--red`. The onboarding form shows its three
sections as `heading` items with a quiet step count (`١ من ٣`) and saves a draft as the person types.
Everything else is W34's renderer.

Slop test before shipping (Hallmark): screenshots at 320, 375, 414, 768 and 1280 px of every screen
below, light and dark (and Arabic and English for the portal), scored on the six axes (anything under 3
is revised), the component gates (visual, contrast, accessibility, typography), eight states for every
interactive element in the slice's preview page, and the English copy through humanizer; results in
the slice report.

### 5.1 Log a win (cockpit, FormSheet def `win`, client page action and Money tab)

| Element | Copy |
|---|---|
| Action | `Log a win` (client page Actions; Money tab header; Today's `Log it` on a done review ask) |
| Sheet title | `Log a win for {client}` |
| Kind | label `What did you win?`; chips per 3.1 words; upsell chips under a small heading `Upsells` |
| Date | `When` (default today; hint `Today or within the last 30 days.`) |
| Proof | review `Review link or screenshot link`; video `Video link`; podcast `Episode link`; upsell `Proposal` (picker of sent proposals) or `Proof link`; renewal and reactivation `Agreement link (optional now, needed for pay)` |
| Referral | `Referred client` (picker of signed deals of the last 120 days, by business name) |
| Upsell money | `Quoted price (USD)`; `Monthly` tick → `Monthly amount (USD)`; `Why below the list price?` when lower |
| Note | `Note (optional)` |
| Submit | `Log the win` → toast `Logged.`; upsell from a proposal: `Mark as offered` → `Marked as offered.` |
| Duplicate warning | the SQL warning + `Log it anyway` / `Cancel` |
| Trail (FormSheet after-send) | `Win stored` → `Card comment queued` → `Card comment confirmed` → `Posted in #csm-announcements` (each a StatusChip; held states read `Waits for the switch-on`) |
| Refusals | the SQL sentences of 4.2, word for word |
| Network error | `Not saved. Check your connection and press Log the win again.` |

### 5.2 Wins on the client page and the Money tab (cockpit, `ClientWins.tsx`)

`SectionCard` `Wins`: one ribbon row per win (5.0), newest first; actions per stage: Offered →
`Mark accepted` (asks `Signed agreement link`) and `Void`; Accepted → `Invoice this`, `Tie a payment`
(dialog listing `cockpit_win_tie_candidates`: `{rail} · {usd} · {date}` with `Not checked yet` chips;
submit `Send to the CEO` → `Sent to the CEO to confirm.`) and `Void`; Paid recurring → `Add {monthly} to
MRR?` (opens Set MRR). Void asks `Why are you voiding it?` → `Voided.` Empty: `No wins yet. Log one with
Log a win.` Money tab: the same rows across clients with filters `This month · Last month · Pick dates`
and tiles `Upsells offered`, `Accepted`, `Upsell cash (checked)`, `Reviews and testimonials`.

### 5.3 Offer Studio (cockpit, `ProposalPage.tsx`, `OffersTab.tsx`, `PitchLog.tsx`)

On a sent proposal: `Mark as offered` (disabled on a draft with the hint `Send the proposal first. A
draft is not a win.`); once offered the header shows the ribbon. A proposal marked accepted shows the
banner `The client accepted. Send the agreement, then mark it accepted with the agreement link.`

### 5.4 CEO: win ties and pay proposals (cockpit, CEO Team & payroll and Money)

Tie decision (Money tab band `Upsell payments to confirm`): row `{client} · {offer} · {rail} {usd} paid
{date}` → `Confirm the tie` (→ `Tied. The win is paid.`) / `Decline` (asks a reason). Pay month card
(`PayMonthCard.tsx`): a block `Proposed from wins` above the typed parts: one row per proposal
`{person} · {part label} · {client} · {amount}` with `Confirm` (→ `Added to {month}.`) and `Decline`
(asks a reason); waiting rows show their sentence in amber; empty: `No wins to pay for {month}.`; with
the switch off the block reads `Pay proposals open after their switch-on.` Typed entry dialog
(`PayEntryDialog.tsx`) for a win-backed part adds `Not in the wins ledger? Say why` (required unless a
proposal is picked) and the SQL sentences of 4.9.

### 5.5 CEO: lifetime value (cockpit, Billing tab card `Lifetime value`, replacing the Money tab Apply)

Header `Lifetime value` + source line `The card's starting value plus every checked payment tied to
the client since. Written to ClickUp each morning.` Tiles `Cards up to date`, `Written today`, `Waiting
for you`, `No starting value`. List rows `{client} · card {usd} · cockpit {usd} · {+/- delta}` with
state words `Same`, `Writes tomorrow morning`, `Held: over {max} change` (→ `Write it` → `Written. It
reaches the card within a few minutes.`), `No starting value`. With the switch off: `The morning writer
is off. Nothing is written to the card.` The source line adds the independent check: `Checked
against the payments tied straight to each card: {ok | n cards differ}.` (6.2 `ltv-second-source`).
The Money tab Apply follows `cockpit_form_doors().ltv`: while it is false (before D-LTV) the
existing `LtvWriteCard` and its Apply show exactly as today, so a writer exists until the morning
writer starts; once it is true the Apply is replaced by the line `Lifetime value is written by the
cockpit every morning now. See the Billing tab.` `loggedWaiting` > 0 adds `{n} logged payments wait
on a check and are not counted yet.`

### 5.6 Pending payments and Checks waiting (cockpit, pairs in both apps)

Confirm paid row adds, before the press, `Next payment moves to {date}` or the `dateWhy` sentence
(4.6); after: `Confirmed. Next payment {date}.` (or `Confirmed. Next payment date stays {date}.`).
Withdraw after a move: `Withdrawn. Next payment back to {date}.` or the 4.6 sentence. Each open part
adds `Ask for the receipt` (opens Send a form preset; disabled with `A receipt request is already out,
sent {date}.`). Checks waiting rows add `Receipt from the client · {date}` with `View the receipt`
(opens the signed link in a new tab; a HEIC file shows `Download to view` instead, since desktop
browsers cannot show HEIC), `May be the same transfer as {date} {amount}` on a near match (4.10.3),
or `Ask the client for the receipt` on a logged transfer without one.

### 5.7 CEO: billing agent login (cockpit, Billing tab card)

`Billing agent login`: `Signed in with its own key since {date} · last call {time} · {n} calls today`
/ `No key yet. The agent still uses the old access until the next deploy step.` When D-AG recorded
separation as not achieved (4.5), the card adds `The agent writes through its own key, but it can
still read the old key on the server. A separate server user fixes this.` (setting `billing.agent`
`{"separated": bool}`, written by D-AG). Action `Revoke` (asks
`Why?`) → `Revoked. The agent cannot write until a new key is set on the server.` No key is ever shown.

### 5.8 Bank transfer receipt (portal and link) — `bank_receipt`

| Key | Type | EN | AR |
|---|---|---|---|
| title | | Send your transfer receipt | أرسل لنا إيصال التحويل |
| intro | | Your account manager asked for the receipt of your bank transfer. We check it against our bank and confirm. | مدير حسابك طلب إيصال التحويل البنكي. بنشيّك عليه مع البنك وبنأكد لك. |
| context `expectedAmount` | number | Amount due | المبلغ المطلوب |
| context `dueOn` | date | Due on | تاريخ الاستحقاق |
| `amount` | number, required, min 0.001, decimals 3, prefilled from `expectedAmount` (editable) | Amount you transferred | المبلغ اللي حولته |
| `currency` | choice, required, prefilled from the context's `currency` (editable) | Currency | العملة |
| options | | Kuwaiti dinar (KWD) · US dollar (USD) | دينار كويتي (KWD) · دولار أمريكي (USD) |
| `paidOn` | date, required, notAfter today, notBeforeDays 120 | Day you made the transfer | يوم التحويل |
| `reference` | text, optional, ≤ 60 | Bank reference (if you have it) | رقم المرجع من البنك (إذا عندك) |
| `receipt` | file, required | The receipt | الإيصال |
| hint | | A photo or a PDF, up to 10 MB. | صورة أو PDF، لين ١٠ ميغا. |
| tile empty | | Add the receipt | أضف الإيصال |
| uploading | | Uploading… | قاعد يرفع… |
| uploaded | | Uploaded: {name} · {size} | انرفع: {name} · {size} |
| replace | | Replace | غيّره |
| submit | | Send the receipt | أرسل الإيصال |
| done | | Thanks. We'll check it against our bank and confirm. | مشكور. بنشيّك عليه مع البنك ونأكد لك. |
| WhatsApp | | Hi {client} team, could you send us the receipt of your bank transfer here: {form_link} | هلا فريق {client}، ممكن ترسلون لنا إيصال التحويل البنكي من هني: {form_link} |
| push | | Your account manager asked for your transfer receipt. Tap to send it. | مدير حسابك يبي إيصال التحويل. اضغط وأرسله. |

`reads`: `receipt_hook` → `amount`, `currency`, `paidOn`, `reference`, `receipt`. No line mentions
leads, cost or results.

### 5.9 Client onboarding (portal, native) — `onboarding` version 2

The questions keep the Typeform's wording (4.14). New lines:

| Key | EN | AR |
|---|---|---|
| title (if the Typeform's is missing) | Tell us about your business | عرّفونا على شغلكم |
| intro (n = 25; revision 2: 36 questions, 11 long) | Tell us about your business so your onboarding call starts in the right place. It takes about 25 minutes. Your answers stay on this device, so you can finish it in more than one sitting. | عرّفونا على شغلكم عشان مكالمة الانطلاق تبدي من المكان الصح. تاخذ تقريباً ٢٥ دقيقة، وردودكم تنحفظ على هالجهاز، فتقدرون تكملونها على كم مرة. |
| step count | {i} of {n} | {i} من {n} |
| draft line | Your answers are saved on this device for 7 days. | ردودكم محفوظة على هالجهاز لمدة ٧ أيام. |
| submit | Send my answers | أرسل ردودي |
| done | Got it. Your account manager will see your answers before your onboarding call. | وصلنا. مدير حسابكم بيشوف ردودكم قبل مكالمة الانطلاق. |
| Getting started card | Your onboarding form · Fill it before your onboarding call. | فورم التعريف · عبّوه قبل مكالمة الانطلاق. |
| Getting started card, sent | Your account manager has your answers. | مدير حسابكم وصلته ردودكم. |
| card buttons | Start · Continue · Sent on {date} | ابدِ · كمّل · انرسل {date} |
| WhatsApp (CSM send) | Hi {client} team, here is your onboarding form. Fill it before our onboarding call: {form_link} | هلا فريق {client}، هذا فورم التعريف. عبّوه قبل مكالمة الانطلاق: {form_link} |
| push | Your onboarding form is ready. Tap to start. | فورم التعريف جاهز. اضغط وابدِ. |

### 5.10 Shared portal copy added (file, date and number fields)

| Code | EN | AR |
|---|---|---|
| `file_missing` | Add the receipt to send it. (generic: Add the file to send it.) | أضف الإيصال عشان ترسله. (عام: أضف الملف عشان ترسله.) |
| `file_type` | Send a photo (JPG, PNG, WEBP, HEIC) or a PDF. | أرسل صورة (JPG أو PNG أو WEBP أو HEIC) أو PDF. |
| `file_size` | This file is over 10 MB. Send a smaller photo or PDF. | الملف أكبر من ١٠ ميغا. أرسل صورة أو PDF أصغر. |
| upload failed | The upload did not finish. Check your connection and try again. | الرفع ما كمل. شيّك على النت وجرب مرة ثانية. |
| slots | You can replace the file 4 times. Ask your account manager for a new link. | تقدر تغيّر الملف ٤ مرات بس. اطلب رابط يديد من مدير حسابك. |
| date `range` (future) | Pick today or an earlier day. | اختار اليوم أو يوم قبله. |
| date `range` (old) | Pick a day in the last 120 days. | اختار يوم خلال آخر ١٢٠ يوم. |
| number `range` | Write the amount, above 0. | اكتب المبلغ، أكثر من صفر. |
| `format` url / email / phone | Write a full link, like https://… · Write a full email address. · Write a phone number with its country code. | اكتب الرابط كامل، مثل https://… · اكتب الإيميل كامل. · اكتب رقم التلفون مع رمز الدولة. |
| date picker | Pick a day | اختار يوم |

### 5.11 Reactivate (cockpit, FormSheet def `reactivate`, client page action on a Stopped card)

| Element | Copy |
|---|---|
| Action | `Client is back` (client page Actions, shown on a card with a confirmed departure not yet returned; churn tracker row `Back`). On a Stopped card without a confirmed departure it shows disabled with `Confirm the churn first with Client is leaving, then reopen.` (X30) |
| Sheet title | `{client} is back` |
| Read-only facts | `Left on {date} · {reason} · {churn type}` |
| Fields | `Back from` (date); `Back as` (`Active`, `Onboarding again`); `Next payment date (optional)`; `MRR (USD, optional)`; `Agreement link (optional, needed for pay)`; `Why did they come back?`; `Call (optional)` |
| Submit | `Reopen the client` → `Reopened. The card updates within a few minutes.` |
| Trail | `Stored` → `Card queued` → `Card confirmed` → `Posted in #csm-announcements` |
| Refusals | the SQL sentences of 4.12 |

### 5.12 Notices routing, Today bands and runbook words

Notices routing labels: `Win logged` (blurb `A CSM logged a win or an upsell moved.`), `Receipt in` (`A
client sent a transfer receipt to check.`), `Client is back` (`A churned client was reopened.`).
Today bands (hidden when empty): `Client accepted: send the agreement for the {offer} ({client})` →
`Open the proposal`; `Invoice paid: tie it to the {offer} ({client})` → `Tie the payment`; CEO only:
`Upsell payments to confirm: {n}` → `Open Money`; `Receipt in: {client}` → `Open Checks waiting`;
`Back: {client}` (7 days) → `Open the relaunch ticket`; `Receipt checked: set the next payment date to
{date} ({client})` → `Open the billing sheet`; `Payment due {date}, no money in: ask for the receipt
({client})` → `Ask for the receipt` (4.10.6).

### 5.13 The kickoff sheet (cockpit, `src/forms/kickoff.ts` + FormSheet def `kickoff`)

Title `Kickoff for {client}`; fields in the Typeform's three groups with their existing words and the
prefill chips (`From the onboarding form`, `From the card`); New MRR at the end; submit `Send the
kickoff` → toast `Sent.`; trail `Kickoff stored` → `Card queued` → `Card confirmed` → `Tech and creative
tasks made` → `Phase 4 message waits for your approval` → `Posted in #csm-general`. While not live the
page keeps today's embedded Typeform and the line `The kickoff moves into the cockpit after its
switch-on.` Second send: `A kickoff was sent on {date}. Say why you are sending it again.`

The sheet asks the database's questions (`cockpit_form_stage4_fields('kickoff')`: the same keys, refs and
options, in its order, inside the cockpit's three groups); `kickoff-sheet.test.tsx` reads the latest
migration's list. Service Advertised and the consultation types are tick lists sent in the order ticked
(each option once, the first tick kept), with the hint `Tick the main service first: the card's Service
Advertised takes the first one you tick.` It asks all 46 of `20261102m`'s questions: the five follow-ups each
after the question it follows, shown as `tG7dnxBn`'s logic shows them (the first four when their parent is
answered No, Contract changes needed after `Adjustments requested by client`; a hidden answer is never
sent). A question is required exactly where `tG7dnxBn` requires it (13 of them), and each text carries the
database's limit (4,000 characters for a long text, 500 for any other) so an over-long answer is stopped
before the send. A send the database's check refuses stores nothing and keeps the sheet open with its
answers: `The kickoff was not stored. {question}: {what to do}. … Then send it again.`, each question by its
words (a group's `Anything to add?` with its group) and what to do (`answer it`, `pick one of its choices`,
`shorten it to N characters or fewer`, `paste the whole link, starting with https://`, or the number's
limits), and, when the check names a question the sheet does not ask or a code the CSM cannot fix, `The
kickoff was not stored: the database did not take the sheet's answers. Your answers are still here. Tell
the tech lead.`

### 5.14 Retired forms (cockpit, Settings → Forms, CEO and admins)

`SectionCard` `Old forms and scenarios`: rows `{name} · {kind} · {state words}` where states read `Still
on`, `Switched off {date}`, `Closed {date}`, `Removed {date}`, `Archive from {date}`, `Archived {date}`,
`Kept: {replacement}`; the replacement and the owner role under each. Empty: never (seeded).

---

## 6. Workers, crons, monitoring and the runbook

### 6.1 Crons and workers

| Job | Where | Schedule | Off switch |
|---|---|---|---|
| LTV step | pg_cron `mahara-billing-daily` (existing, `10 5 * * *` UTC) → `cockpit_billing_daily_run` | daily | `billing.ltv.on=false` |
| Card writes `win`, `reactivate`, `ltv`, confirm `date` | `clickup-writeback` (existing, kind `billing`) | existing | the kind out of `CLICKUP_WRITEBACK_BILLING_KINDS` (`date` is already in; the confirm path has its own setting) |
| Kickoff and onboarding card writes | `clickup-writeback` kind `form` (existing cron `mahara-clickup-writeback-forms`) | every minute | `CLICKUP_WRITEBACK_FORMS_KEYS` without the form |
| Phase 3 and 4 WhatsApp (the content folder link put in at send, X35) | `hermes/client-messages` (existing) | every minute | `CLIENT_MESSAGES_KINDS` without the kind |
| Relay (GitHub dispatch only; no Client Data write, X34) | `hermes/forms-relay` (new, VPS cron under `flock`) | every 2 minutes | `FORMS_RELAY_APPLY=false` |
| Agent door | Edge `billing-agent` | on call | no key row |
| Notices | `cockpit-notices` (existing) | every minute | each kind's settings row |

### 6.2 Guardian (`hermes/cockpit-guardian/checks/wins_cash.py`, registered in `checks/__init__.py` after `client_forms`; report-only)

| Check id | Reads | Warn / fail |
|---|---|---|
| `ltv-daily` | `cockpit_sync_state` `billing-daily` note, and the writer's own row `billing-ltv` | fail when `billing-daily` is older than 26 h while `billing.ltv.on`; fail, quoting its note, when `billing-ltv` is `ok=false`, missing or older than 26 h (a missing or old row is ok only within 26 h of `billing.ltv` being turned on: the first run is still due); warn on any held row older than 3 days |
| `ltv-drift` | `cockpit_billing_accounts.ltv_field_usd` vs the last delivered `ltv` event target per card | warn when they differ 2 days after delivery ("{n} cards show a different LTV than the cockpit wrote") |
| `ltv-second-source` | checked `cockpit_manual_payments` by `clickup_task_id` plus rail payments with a live payment tie to the card, since `baseline_day`, straight from the rail and tie tables, vs `cockpit_ltv_plan(today).checked_usd` | warn when that floor exceeds `checked_usd` by more than $1 on any card ("{n} cards: payments tied straight to the card exceed the cockpit's LTV sum") |
| `agent-separation` | setting `billing.agent.separated` | warn while it is false after D-AG ("The billing agent can still read the old key on the server.") |
| `win-ties-open` | `cockpit_win_tie_proposals` open | warn when older than 3 days |
| `win-unpaid-accepted` | wins `signed` older than 45 days with no tie | warn ("{n} accepted upsells have no payment tied") |
| `pay-proposals` | `cockpit_win_pay_rows(previous month)` on the 3rd to 10th | warn on proposals neither confirmed nor declined |
| `receipts-unchecked` | Checks waiting rows with a client receipt | warn after 2 business days |
| `agent-door` | `cockpit_agent_calls` | fail on `refused` bursts (> 10 in an hour); warn when no call in 48 h after D-AG |
| `retire-quiet` | `cockpit_retire_items_v` | info list of `ready` items; warn on an `off` item that saw a legacy answer in 24 h |
| `stage4-legacy` | responses `legacy` for `kickoff`/`onboarding` after go-live | warn on any |
| `stage4-effects` | `cockpit_form_effects` of `kickoff`/`onboarding` | warn on `failed` or `unknown`; fail on a response with no effect rows 30 min after submit |
| `relay` | `cockpit_form_relay_outbox` | warn on `claimed` older than 15 min or any `unknown` |

Before deploy each check reads "not set up yet" as ok, never as zero. They read tables and views over
REST with the service key, never the seat RPCs.

### 6.3 Runbook rows (`RUNBOOK.md`, client-tail writes them all)

"Turn the LTV writer on or off; release a held jump"; "Why did Confirm paid not move the date"; "The
billing agent's key: replace, revoke, what the door refuses, and whether the agent can still read the old key (D-AG0, `billing.agent.separated`)"; "Log a win, upsell stages and ties";
"Confirm or decline a pay proposal; a typed entry outside the ledger"; "Ask a client for a receipt; view
it; check it"; "Reopen a churned client"; "The retire list: switch off, archive after 14 quiet days,
undo"; "Stage 4: the kickoff and onboarding go-live and go-back"; "The forms relay"; "A parity
difference"; "Roll back a migration with screens on it" (W12's row, now for `g` to `j`).

### 6.4 SOURCES.md rows (wins-pay)

Wins (`clients.wins.*`: "Wins the CSM or the CEO logged in the cockpit with their proof, by win date;
imported Typeform wins are voided history and not counted"); Upsells (`money.upsells.offered`,
`.accepted`: "Offered = a sent proposal or a proof link with a price; accepted = an agreement linked;
counted by the day of the offered or accepted event in the window, so a paid upsell still counts;
drafts never count"); Upsell rate (`upsellRate`: "accepted ÷ offered, both by event day in the
window; not known when nothing was offered"); Upsell cash (`money.upsells.cash`: "Checked payments the CEO tied to an upsell
win, by payment day; always back end, never in front-end cash"); LTV (amend the existing row: "written
every morning by the cockpit from the same rule; checked money only; jumps over $5,000 wait for the
CEO; the Money tab Apply is retired"); Pay ("Win-backed parts are confirmed from proposals; a typed
entry outside the ledger carries its reason").

---

## 7. File ownership

Six slices, each in **one repo**. A file appears under exactly one slice. Pairs that
`scripts/check-shared.sh` compares belong to one slice together. If a slice needs a change in
another's file, it leaves a note in its report (file, line, the change) and does not edit it.

| Slice | Repo | Starts | Depends on | Migration | Owns |
|---|---|---|---|---|---|
| **money-rails** | cockpits | at once | none | `20261102g_money_rails_w5.sql` | migration `g`; `supabase/functions/cockpit-notices/{text.ts,send.ts,doctor.ts,text.test.ts,run.test.ts,testkit.ts}`; `apps/client-success-cockpit/src/lib/notices.ts`, `apps/client-success-cockpit/src/components/NoticesRouting.tsx`, `apps/client-success-cockpit/src/dev/noticesFixtures.ts`; `supabase/functions/clickup-writeback/{billing.ts,billing.test.ts}`; `supabase/functions/cockpit-media-api/{ltv.ts,ltv.test.ts,index.ts}`; `supabase/functions/billing-agent/**` (new); `viktor-side-scripts/billing-agent/**` (new); `apps/media-buyer-cockpit/scripts/money-rails-w5-supabase.test.ts` (new); `apps/media-buyer-cockpit/scripts/ceo-actions.test.ts` (run unchanged: `ltv.preview` is not replaced; edited only if it pins the apply) |
| **wins-pay** | cockpits | after money-rails' migration file lands | money-rails | `20261102h_wins_pay.sql` | migration `h`; `hermes/ceo-refresh/native/adapters/money.js`, `hermes/ceo-refresh/native/metrics.ts`, `hermes/ceo-refresh/wins.test.ts` (new); `supabase/functions/cockpit-ceo-api/finance/{attribution.ts,adapters/money.ts}`; `apps/media-buyer-cockpit/scripts/{money-attribution-parity.test.ts,attribution.test.ts}`; `apps/media-buyer-cockpit/convex/ceo/metricRegistry.ts`; `apps/media-buyer-cockpit/src/pages/ceo/SOURCES.md`; `docs/money/MONEY-ATTRIBUTION.md`, `docs/pay/PAY-PLANS.md`; `scripts/dev/{wins_backfill.py,test_wins_backfill.py}` (new); `apps/media-buyer-cockpit/scripts/wins-pay-supabase.test.ts` (new) |
| **client-tail** | cockpits | after money-rails' migration file lands | money-rails | `20261102i_client_tail.sql` | migration `i`; `supabase/functions/cockpit-forms-api/{door.ts,files.ts,door.test.ts,files.test.ts}`; `hermes/cockpit-guardian/checks/{wins_cash.py,__init__.py}`, `hermes/cockpit-guardian/tests/test_wins_cash.py`; `RUNBOOK.md`; `apps/media-buyer-cockpit/scripts/fixtures/client-form-answers.json`; `apps/media-buyer-cockpit/scripts/client-tail-supabase.test.ts` (new) |
| **stage4** | cockpits | after client-tail's migration file lands | client-tail | `20261102j_stage4_native.sql` | migration `j`; `supabase/functions/forms-door/**`; `supabase/functions/clickup-writeback/{forms.ts,forms.test.ts,run.ts,run.test.ts}`; `hermes/forms-relay/**` (new); `hermes/client-messages/{worker.ts,core.ts,worker.test.ts,core.test.ts,RUNBOOK.md}`; `hermes/ceo-refresh/native/adapters/growth.js`, `hermes/ceo-refresh/growth-kickoff.test.ts` (new); `hermes/csm-calls/{sources.ts,sources.test.ts}`; `scripts/dev/{forms_legacy_backfill.py,test_forms_legacy_backfill.py,make_parity.py,test_make_parity.py}`; `apps/media-buyer-cockpit/scripts/stage4-native-supabase.test.ts` (new) |
| **cockpit-screens** | cockpits | at once (against 3.3's names; tests stub the RPCs) | merges after the four SQL slices | none | `apps/client-success-cockpit/src/components/{ClientWins.tsx,WinRibbon.tsx,ClientAsks.tsx,ClientForms.tsx,CommandPalette.tsx}`; `apps/client-success-cockpit/src/lib/{wins.ts,winsCore.ts,csmMoney.ts,csmLinks.ts,clientBrief.ts,useCsmSnapshot.ts,churnClient.ts,churnCore.ts,invoices.ts}`; `apps/client-success-cockpit/src/pages/{CsmPage.tsx,MoneyPage.tsx,ChurnPage.tsx,SettingsPage.tsx}`; `apps/client-success-cockpit/src/pages/money/offers/{ProposalPage.tsx,OffersTab.tsx,PitchLog.tsx}`; `apps/client-success-cockpit/src/components/invoices/InvoiceForm.tsx`; `apps/client-success-cockpit/src/forms/{kickoff.ts,prefill.ts}`; pairs `apps/{client-success,media-buyer}-cockpit/src/forms/staff/{FormSheet.tsx,formSheet.css,formSheetCore.ts,formDefs.ts,lifecycleClient.ts}`; pairs `apps/{client-success,media-buyer}-cockpit/src/components/billing/PendingPayments.tsx`, `apps/{client-success,media-buyer}-cockpit/src/lib/billingBalances.ts`; `apps/{client-success,media-buyer}-cockpit/src/components/billing/ChecksWaiting.tsx`; `apps/media-buyer-cockpit/src/lib/{csmMoney.ts,csmLinks.ts,csmTemplates.ts}`; `apps/media-buyer-cockpit/src/pages/ceo/pay/{PayMonthCard.tsx,PayEntryDialog.tsx,payCopy.ts}`; `apps/media-buyer-cockpit/src/pages/ceo/{BillingTab.tsx,MoneyTab.tsx,moneyImport.tsx,ltvRefusal.ts,goalsSheetModel.ts,goalsLockIn.tsx}`; `apps/media-buyer-cockpit/src/lib/cockpitApi.ts` (its `ceo.ltv.apply` entry stays while the Apply shows); `apps/media-buyer-cockpit/scripts/ceo-fixes-screens.test.ts` (it inspects `LtvWriteCard`); `viktor-side-scripts/csm/csm_assistant.py`; `apps/client-success-cockpit/src/dev/{winsFixtures.ts,formHarness.tsx}`; `apps/client-success-cockpit/scripts/{wins.test.tsx,form-sheet.test.tsx,churn.test.ts,guide-links.test.ts,kickoff-sheet.test.tsx}`; `apps/media-buyer-cockpit/scripts/{pay-proposals.test.tsx,ltv-card.test.tsx,billing-pending-screen.test.tsx,stage1-ownership.test.ts,stage2b-ownership.test.ts}` (the last two only where they pin a changed link row) |
| **portal-56** | portal | at once (against 3.3 and 3.6; tests stub `fetch`) | none to build; its release waits for D-I1 | none | `src/lib/{client-form-schema.ts,client-forms.ts,form-token.ts,form-files.ts,onboarding.ts,onboarding-policy.ts,onboarding-native.ts,billing-ltv.ts}`; `src/components/forms/{FormRenderer.tsx,FormRenderer.module.css,FileTile.tsx,DateField.tsx,FormsPage.tsx,TokenForm.tsx}`; `src/components/{OnboardingJourney.tsx,PersonalForm.tsx,OnboardingForm.tsx}`; `src/app/api/forms/route.ts`, `src/app/api/forms/token/route.ts`, `src/app/api/forms/file/route.ts` (new), `src/app/api/forms/token/file/route.ts` (new), `src/app/api/onboarding/route.ts`; `src/app/preview/client-form/page.tsx`; `tests/{client-form-schema.test.ts,form-files-route.test.ts,form-renderer.test.ts,onboarding-native.test.ts,billing-ltv-retired.test.ts}`, `tests/fixtures/client-form-answers.json`; `docs/{CLIENT-FORMS.md,BILLING-DATA.md}` |

Cross-slice touch points, settled here so nobody edits another's file:
- **Billing kinds** `win` and `reactivate` (writes, comments, trigger, canary) are money-rails'; wins-pay and client-tail only insert those events with 3.5's details.
- **Notice kinds** are money-rails' (SQL and `text.ts`); wins-pay and client-tail insert notices of those kinds with 3.9's facts.
- **`cockpit_form_doors()`** is money-rails'; each later migration only flips nothing (markers are seeded by `g` and flipped at deploy).
- **The answers check and the fixture** are client-tail's; portal-56 copies the fixture byte for byte; stage4's onboarding schema must pass client-tail's `cockpit_form_schema_check` (stage4's test applies `i` first).
- **`cockpit_form_card_allows`** (rules for `onboarding`) and the invite purpose/origin CHECKs are client-tail's; stage4 calls `cockpit_form_invite_issue_system` with origin `portal`.
- **Reactivation wins**: client-tail's act inserts a `cockpit_csm_wins` row (`h` must exist: client-tail's test applies `h` before `i`; the order of 2.1 already holds).
- **The forms-door** is stage4's alone in this wave (no other slice touches it).
- **The Set MRR edit** (W12) is reused unchanged; cockpit-screens opens it prefilled.
- **The Send panel** (`ClientForms.tsx`, W34) is cockpit-screens': it gains a preset (form and context) so Pending payments, Checks waiting and the kickoff page can open it on the bank receipt or the onboarding form.
- **`check-shared.sh`** is not touched: no new pair.
- **The `mrr` reason labels** `new_client` and `reactivation` are money-rails' (comment and detail functions in `g`); stage4 (New MRR) and client-tail (Reactivate) only insert `mrr` events with 3.5's details.
- **The ordinary tie RPCs** `cockpit_ceo_payment_tie` / `_untie` are replaced by wins-pay (`h`) only; no other slice edits them.
- **The inbox duplicate trigger** (receipts on a twin) is client-tail's; ingest is not replaced.
- **The onboarding Typeform door** (`cockpit_form_onboarding_typeform` and its forms-door call) is stage4's.
- **`billing.agent`** is seeded by money-rails (`g`), written only at D-AG, read by the CEO card (cockpit-screens) and the guardian (client-tail).
- **The Money tab Apply** (`MoneyTab.tsx`, `moneyImport.tsx`, `cockpitApi.ts`, `ceo-fixes-screens.test.ts`) is cockpit-screens'; money-rails changes only the Edge refusal.

---

## 8. Tests each slice runs green

Every cockpit slice: `tsc -b` in each app it touches, `biome check` on its files, `scripts/check-shared.sh`
once pairs land, and its PGlite test applying the live chain (`20261101l` to `20261102f`) then its own
file(s) twice. Every portal slice: `npm test` (all), `node node_modules/typescript/bin/tsc --noEmit`, and
`npm run build`.

| Slice | Tests |
|---|---|
| money-rails | `cd apps/media-buyer-cockpit && bun test scripts/money-rails-w5-supabase.test.ts scripts/money-acts-supabase.test.ts scripts/checked-money-supabase.test.ts` (the last two unchanged and green); `cd supabase/functions/cockpit-notices && bun test`; `cd supabase/functions/clickup-writeback && bun test billing.test.ts`; `cd supabase/functions/cockpit-media-api && bun test ltv.test.ts`; `cd supabase/functions/billing-agent && bun test`; `python3 -m unittest viktor-side-scripts/billing-agent/test_cockpit_agent.py`. Asserts: `g` applies twice; the drift guard refuses a changed body; the trigger queues ceo/csm `win` and `reactivate` and still refuses system pause; `win` writes no field and posts 3.5's comment; `reactivate` writes status by option id and clears the five fields (read back against a stubbed ClickUp, including null clears); `cockpit_ltv_plan` on a fixture equals the preview rule except a `checked:false` transaction is left out (fixture: Ardon-like +2,000 checked counted, the same unchecked not); guards refuse a stale money section; the daily step writes nothing while off, writes `ltv` events while on, holds a jump over `maxDeltaUsd`, skips a card with an undelivered `ltv` item, and is idempotent on a second run; `cockpit_ltv_release` refuses a changed target and a non-CEO; confirm on a monthly `later` part due on the card date moves the date one month and reads back; on a split moves to the next part's due date; on a part not due on the card date does not move; withdraw reverses only while the mirror shows the moved date; one date write per save; `dateIfConfirmed` equals what confirm writes; the agent door refuses an unknown and a revoked key, identifies the agent from the row, never stores a raw key or logs a hash, writes `chase`/`invoice`/`note` events as `maher`, an inbox row `logged` for `payment`, refuses a transfer without evidence, rate-limits at 61 calls a minute, returns the first result on a repeated request id; the Edge door returns 401 without a well-formed key and never echoes it; `prepareLtv` throws the retirement sentence; the three notice kinds render 3.9 and carry no email; `cockpit_form_doors()` reports each new flag false until its functions and marker exist, with `why` `missing` or `off`; a re-apply of `g` after `forms.doors.wins`, `billing.ltv.on` and `billing.confirm_date.on` are set true leaves all three true; `cockpit_billing_agent_read` is `VOLATILE` and one read writes exactly one calls row; a repeated request id writes a `duplicate` row with `request_id` NULL and `detail.firstCallId` and returns the first result; the `chases` read returns only the agent's own events; a tied transaction without `checked` makes the LTV run refuse with its sentence; a card held, released and held again gets a second hold row; the `mrr` comment labels `new_client` and `reactivation`; the Python client never prints the key and its doctor fails without it; `ceo-actions.test.ts` green unchanged. |
| wins-pay | `cd apps/media-buyer-cockpit && bun test scripts/wins-pay-supabase.test.ts scripts/money-attribution-parity.test.ts scripts/attribution.test.ts scripts/money-ties-supabase.test.ts`; `cd hermes/ceo-refresh && bun test`; `python3 -m unittest scripts/dev/test_wins_backfill.py`. Asserts: `h` applies twice after `g`; every table has row security, no browser grant, refuses delete; the seat gate (a CSM on another client refused by every win RPC; anon refused); proof per kind; a draft proposal cannot become offered; accept needs the agreement; the stage guard refuses every move outside 3.2; a duplicate review warns and stores nothing without `confirmDuplicate`; a repeated request id returns the first win; tie propose needs `signed`; the CEO's confirm refuses a logged transfer and a payment already tied, sets `paid` and writes one tie with `win_id`; one payment cannot tie to two wins (the index); **attribution**: an upsell payment on day 30 of a deal's term is back end, absent from the deal ledger and the contract total, credited to the card's CSM, and both copies agree; without `win_id` the same payment is front end; a cleared win tie falls back; pay rows per 4.9's table (each waiting sentence; a referral waits until the referred deal pays; recurring engagement months 1, 2, 3; a part missing from the plan waits); confirm creates exactly one entry through the entry save path and records the decision; a second confirm of the same key is refused; an approved month refuses; with `pay.proposals.on` false both RPCs refuse; the C7 rule refuses a win-backed typed entry without `win:` or `outsideLedger`, accepts it with either, refuses a second entry with the same `win:` reference, part and month, and leaves adjustments and other parts unchanged (a replay of the live body's accepted shapes still passes); `cockpit_wins_v` is selectable by `supabase_read_only_user`; the metrics read missing as not known, never 0; the backfill prints counts only and inserts void wins that pay nothing; the import writes no billing event, notice, card comment or form response; the replaced `cockpit_ceo_payment_tie` and `_untie` refuse a row with a `win_id` and are byte for byte otherwise (a replay of `money-ties-supabase.test.ts`); an ordinary tie cannot displace a win tie; `cockpit_ceo_win_tie_clear` moves the win back to signed, lists the confirmed entries of open months, and is refused when a confirmed proposal of the win sits in an approved month; candidates include a rule-2 card-match remainder (day 30 of the term) and exclude a deposit and a deal-link match; the confirm needs a reason for a deal-ledger payment and refuses one counted in an approved closer month; a second non-void referral win on the same deal is refused; a manual reactivation within 60 days of a Reactivate win is refused; a renewal within 30 days warns; a proposal for an approved month is confirmed into the first open month, once; upsell counts by event day keep a paid win in offered and accepted, and `upsellRate` is not known with nothing offered. |
| client-tail | `cd apps/media-buyer-cockpit && bun test scripts/client-tail-supabase.test.ts scripts/forms-invites-supabase.test.ts scripts/client-lifecycle-supabase.test.ts scripts/churn-confirm-supabase.test.ts` (the last three unchanged and green); `cd supabase/functions/cockpit-forms-api && bun test`; `cd hermes/cockpit-guardian && python3 -m unittest discover -s tests`. Asserts: `i` applies twice after `g` and `h`; the bucket exists private with its limits and no anon/authenticated policy; schema check accepts `file`, `date`, `number`, `heading`, text formats and refuses a `file` with an `accept` outside the bucket's list or `maxBytes` over 10 MB; answers check on every fixture row (codes exact), including a file whose object is missing (`file_missing`), a mime mismatch with `storage.objects` (`file_type`), a size mismatch (`file_size`), a date in the future and older than 120 days (`range`), a number with 4 decimals (`range`), each format; file slots: the 6th slot refused, a closed or not-live invite refused, a token slot logs the open and obeys the limits, the path pattern exact; `bank_receipt` issue only with origin `billing`, the context rule, one open per card, a `manualPaymentId` must be a logged transfer without a receipt; the hook writes a receipt row (no inbox row) for a logged payment and an inbox row source `portal` otherwise, queues `receipt.in` once, never changes the card, and the new inbox row lands `logged` and changes no CEO cash, LTV or pay; `cockpit_manual_payments_to_check` carries `receipt`; `cockpit_form_file_read` refuses a CSM on another client; reactivate: refused without a departure, with a return before the left day, with a short why; accepted writes one `reactivate` event, the departure's `returned_on`, a reactivation win and the notice, and the October churn count is unchanged; the lifecycle view says `returned`; `cockpit_form_card_allows` treats a returned departure as closed and gives `bank_receipt` and `onboarding` their rules; the retire registry moves only per 3.7, refuses archiving before 14 quiet days, and accepts a rollback to `on` only with a note and a step; `cockpit_form_answers_check` has `provolatile = 's'`; a receipt for a part whose transfer the agent already logged (same currency, 1%, 3 days) attaches as a receipt row with no inbox row; an inbox row marked `duplicate` by ingest gets its receipt row on the twin through the trigger; Reactivate on a Stopped card without a confirmed departure is refused with the next-step sentence; the reactivation `mrr` event carries `reason_cat 'reactivation'`; a second reactivation win for the same departure is refused by the index; the guardian checks read "not set up yet" as ok and their warn/fail rules of 6.2, `ltv-second-source` and `agent-separation` included. |
| stage4 | `cd apps/media-buyer-cockpit && bun test scripts/stage4-native-supabase.test.ts scripts/forms-stage3-base-supabase.test.ts scripts/client-voice-supabase.test.ts`; `cd supabase/functions/forms-door && bun test`; `cd supabase/functions/clickup-writeback && bun test forms.test.ts run.test.ts`; `cd hermes/forms-relay && bun test` (or `python3 -m unittest` if written in Python); `cd hermes/client-messages && bun test`; `cd hermes/ceo-refresh && bun test growth-kickoff.test.ts`; `cd hermes/csm-calls && bun test sources.test.ts`; `python3 -m unittest scripts/dev/test_forms_legacy_backfill.py scripts/dev/test_make_parity.py`. Asserts: `j` applies twice after `g` to `i`; the kickoff submit refused while not live except the test card; the answers check; New MRR writes an `mrr` event only when it differs; one kickoff per card and the replace reason; the read model equals the Typeform shape on a recorded kickoff (refs, payment, recording); `growth.js` counts a native kickoff payment exactly as a Typeform one; the planner emits every effect of 4.13 and 4.14 with owners `make` until go-live and `cockpit` after; `cockpit_form_parity_plan` on the recorded Make inputs of the fixture equals the recorded module bundles (the intended differences listed); `forms.ts` writes and reads back each new effect key and holds a key not in `CLICKUP_WRITEBACK_FORMS_KEYS`; the check-in path unchanged (its tests green); `phase3`/`phase4` drafts pass the text rule and the worker sends them only when listed; the relay reads the sheet before writing, records `sent` once, never retries `unknown`, prints counts only while `FORMS_RELAY_APPLY=false`; system requests are deduped per response; `portal_form_onboarding_open` issues one invite, returns it again, and answers `answeredAt` after the answer; onboarding hook queues every effect once; a kickoff Typeform delivery after go-live is stored `legacy` with `legacy.received`; an onboarding Typeform delivery after go-live runs the native planner through `cockpit_form_onboarding_typeform` and equals the portal answer's plan; a card with a stored Typeform onboarding answer gets no invite, `answeredAt` in the portal, and no effects from a second answer; a native kickoff on a card with a Typeform kickoff needs the replace reason and runs only the handoff comment; the Brand DNA and onboarding-task requests are deduped per card; `map_phase3` is kept on a card at phase 5; go-live writes exactly the version-2 arrays of 4.15.2 and off restores the version-1 arrays of 11.2-d, `recap` is never `cockpit`, `cockpit_forms_effects_valid` accepts `relay` and still refuses `requests`; the New MRR event carries `reason_cat 'new_client'` and none is written for 0 against an empty card MRR; `make_parity.py` prints the [24] line and no person, answer or phone. |
| D-S4.0 and D-S4F fixes (`forms-s4-fixes`) | Run file by file (counts read 2026-11-02 after `20261102m`). `cd apps/media-buyer-cockpit && bun test scripts/stage4-native-supabase.test.ts` (37 pass; was 31; it applies `j` then `l`, not `m`), `bun test scripts/stage4-content-folder-supabase.test.ts` (5, new) and `bun test scripts/stage4-match-make-supabase.test.ts` (25, new: `m` on `l`); from the root, `bun test hermes/forms-relay/relay.test.ts` (10); `bun test hermes/client-messages/<file>.test.ts` for each file (core 18, worker 65, g5 7, ledger 9, oldSenders 10, whapi 13); `cd supabase/functions/cockpit-forms-api && bun test messages.test.ts` (22; was 17); `cd apps/client-success-cockpit && bun test scripts/client-messages.test.tsx` (69; was 68) and `bun test scripts/kickoff-sheet.test.tsx` (13: 12 pass and 1 skipped without `MAKE_PARITY_SAVED_DIR`, 13 pass with it; was 6); `python3 scripts/dev/test_make_parity.py` (30 run, 1 skipped without `MAKE_PARITY_SAVED_DIR`, 30 OK with it; was 20); `cd hermes/cockpit-guardian && python3 -m unittest tests.test_wins_cash` (24). Asserts: `l` applies after `j` from the live state (version 1) and after a go-live (version 2), twice, with one audit row; its drift guard takes `j`'s bodies and its own and stops on anything else; the outbox refuses a `client_data_row` row and the file stops on one; the builder, the parity plan and the arrays equal `j`'s without `client_data_row`, the kickoff identical; the relay skips a stray `client_data_row` row, writes no sheet and lets only GitHub calls out; both phase templates pass `cockpit_form_stage4_message` with `{content_folder}` kept once; the worker fills the link only in the one send, masks it back in every group search, and refuses a missing, non-link or column-less link before the wait; the Messages card shows the placeholder as the Client Data link; the evaluator's functions, filters, routers and iterator; fidelity read as ClickUp returns comments; `setting missing` and `NOT PROVEN`; no name, answer, phone or token in any printed line. **`m` (X37):** it applies twice on `l` and leaves `j`'s input and parity plan as they are; it stops with `Apply 20261102l before 20261102m.` on `j`'s builder and on any other changed body; only the owner runs its ten functions; `onboarding.raw_titles` is seeded `{}`, and `stage4-raw-titles.json` equals the evaluator's titles of the saved `KFRCXPFx` (36, in its order); on invented answers the SQL equals `make_parity.py`'s evaluator (run with `python3 -I` on the fixtures) for the handoff and the comment on each onboarding task (empty values; numbers such as 0, 0.0, -0, 1500.50, 1,500 and Arabic-Indic digits; yes/no as true, false, missing and other text; lists as ticked; Arabic text; a handoff over 4,000 characters; both hidden-value sources), Service Advertised (the option ticked first, or nothing), the kickoff's hidden values (Make 13 [29]'s link, with and without an onboarding answer), the raw answers comment (the form's order and full titles, 0 blank, a retired question last), the Client Profile and the dispatch, through the text functions, the parity plan and native answers through the planner; the request keeps the handoff whole on `task_comment` and each part's `taskComment` beside the stopgap details (its first 4,000 characters), the Client Profile is Make's text cut at 5,000 characters with the kickoff link still in its row, and the Brand DNA task has no details and no comment; an empty or partial `onboarding.raw_titles` gives its `missing` sentence while every other effect stands; the five follow-ups and a Yes/No Post call form filled pass the answers check; every other effect equals `l`'s under two settings states. **`cockpit-forms-api`:** a phase draft is approved with the exact text, its sha256, the verified actor and no warnings; refused when empty, over 1,500 characters, holding `{content_folder}` twice or any other placeholder, or by the client text rule, and only as a draft; a recap still needs the booking block. **The cockpit:** the edit counter reads `/ 1,500` for a phase text and turns red past it; the kickoff sheet's fields equal the latest migration's list (keys, refs, options, text types and limits) and `tG7dnxBn`'s order, types, required flags and logic (all 480 combinations of the parent answers; the saved definition itself when `MAKE_PARITY_SAVED_DIR` is set); lists go in the order ticked; a refused send shows its sentence and no `Sent.`. |
| cockpit-screens | `cd apps/client-success-cockpit && bun test scripts/wins.test.tsx scripts/form-sheet.test.tsx scripts/churn.test.ts scripts/guide-links.test.ts scripts/kickoff-sheet.test.tsx`; `cd apps/media-buyer-cockpit && bun test scripts/pay-proposals.test.tsx scripts/ltv-card.test.tsx scripts/billing-pending-screen.test.tsx`; `scripts/check-shared.sh`. Asserts: Log a win shows the proof field per kind and the SQL sentences word for word; one request id per open sheet survives a retry; the ribbon maps every stage and pay state to 5.0's words; Mark as offered disabled on a draft; the tie dialog lists candidates with the not-checked chip; the CEO pay block confirms and declines and shows waiting sentences; the typed entry dialog needs the outside-ledger reason for win-backed parts; the LTV card shows the four tiles and the held release; the Money tab Apply shows while `cockpit_form_doors().ltv` is false and is replaced by the retirement line when it is true (both states); a door with `why` `missing` reads `Opens after the next cockpit update.` and one with `why` `off` reads `Not switched on yet.`; a HEIC receipt shows `Download to view`; the near-match line; the Today bands of 5.12; Pending payments shows `Next payment moves to {date}` from `dateIfConfirmed`; Ask for the receipt and View the receipt; Reactivate sheet on a Stopped card only; the kickoff sheet renders the 38 fields plus New MRR with prefill chips and keeps the embed while not live; every door hides with `Opens after the next cockpit update.` and makes no call; the Four Rs links point at Log a win in both apps and `csm_assistant.py`; the media buyer `kickoffForm` (BbJy6xg4) row is gone; the FormSheet and billing pairs stay identical; layout harness scenarios `wins`, `pay`, `ltv`, `reactivate`, `kickoff` at 375 and 1280 px, light and dark. |
| portal-56 | `npm test` (all), with: `client-form-schema` (every fixture row, codes equal the SQL's, new types); `form-files-route` (401 without a session; the slot RPC receives only metadata; the signed upload URL is for exactly the slot path and expires in 10 minutes; a token file route never calls `identity()` and never logs the token, its hash or the URL; a 10 MB body never passes through the route); `form-renderer` (file tile states empty/uploading/uploaded/error, replace, the 5-slot sentence; date field in both languages with Arabic-Indic digits; number decimals; headings and the step count; the onboarding draft in `localStorage` holds answers only, expires after 7 days and clears on success; the bank receipt's amount and currency are prefilled from the context and stay editable; every section 5.8–5.10 line in both languages); `onboarding-native` (Getting started shows the native form only when `portal_form_onboarding_open` says live, the Typeform embed otherwise; a locked workspace can open it; the gate completes from the native answer); `billing-ltv-retired` (`billing-ltv.ts` returns `retired` with every env combination). The `/preview/client-form` page gains `?form=bank_receipt` and `?form=onboarding` and answers 404 in production. Screenshots per 5.0. |

No test submits a Typeform, posts to Slack, writes ClickUp, calls Make, sends WhatsApp, dispatches to
GitHub, writes a sheet or reaches the live database: recorded payloads, stubbed providers and PGlite
only. Canaries are deploy steps.

---

## 9. The deploy table (the main session, after every slice is merged on its branch and reviewed)

Migrations through the CEO's Composio Supabase connection (memory: supabase-via-composio), each
preceded by the letter rule (2.1), the md5 check against 2.2 and the `before-*.sql` saves; function
deploys through `scripts/dev/deploy_composio.py <slug> --rev <sha> --verify-jwt <live value>` (`--dry`
first; live values read 2026-11-01 for W34: `forms-door` off, `cockpit-notices` off,
`clickup-writeback` off, `billing-sync` off, `cockpit-forms-api` on, `cockpit-ceo-api` on; read the
"before" line again for every slug, including `cockpit-media-api`, and pass what it says; the new
`billing-agent` is deployed `off`, its own key check being the gate); the cockpits through
`scripts/ship.sh client-success` and `scripts/ship.sh media-buyer` from a fresh worktree (Python 3.10+
first on PATH as `python`); the portal through the Mac release steps (memory: portal-deploy-from-mac);
VPS code by native release, file-scoped (memory: native-release). Make and Typeform changes: the
blueprint or definition saved first to the VPS (`~/make-backups/`, `~/typeform-backups/`), each change
read back. Every step is recorded in
`/Users/abdulazizwaheedi/mahara-cockpits/notes/forms-w56/deploy/deploy-log.md` and the session in
mahara-context `shared/sessions/`. Canaries run only on the internal test card `86eywg1cq` (or the
portal's staff preview); never a real client, including rolled-back blocks (D-CD seeds its own
fixture on the test card inside the block). Each canary billing event is voided by record right after
its read-back (`cockpit_billing_event_void_owner`), and every narrowing of `BILLING_ONLY_CARDS` ends
with W12's held-edit review over every open kind (W34 11.4).

| # | Step | Read-back | Rollback |
|---|---|---|---|
| D0 | Pre-checks: letter rule; md5 of every 2.2 function and the lifecycle viewdef equal the table; the finance snapshot md5 `742d03b0…`; `before-*.sql` saved; the chain `g` to `j` applied in one transaction against live and rolled back; `cmp` of the two answer fixtures; portal `origin/main` equals `VERSION.json` `productionSourceCommit`'s tree plus docs | all pass, or the step that failed is fixed on the branch first | none |
| D-G1 | Apply `20261102g` | kinds CHECK; trigger `WHEN` text; three notice rows disabled; `billing.ltv`, `billing.confirm_date` off; door markers false; `cockpit_ltv_read()` as the CEO lists 19 ready cards with Ardon +2,000 and شركة العلا +21.20 as the only writes (11.2-j) | restore saved bodies; trigger from its saved definition; settings rows stay (off) |
| D-G2 | Deploy `cockpit-notices` (off), `clickup-writeback` (off) and the new `billing-agent` (off) | notices doctor names the three kinds; `clickup-writeback:billing` mode `apply` with the kinds unchanged; `billing-agent` 401 on a GET and on a bad key | previous versions |
| D-H1 | Apply `20261102h` | tables; `win_id` columns and the index; `pay.proposals` off; `cockpit_wins_v` selectable as `supabase_read_only_user`; a replay of a typed entry the live body accepts still passes in a rolled-back DO block | saved bodies; tables stay (inert) |
| D-H2 | Deploy `cockpit-ceo-api` (on); native release `hermes/ceo-refresh` file-scoped (`native/adapters/money.js`, `native/metrics.ts`, `wins.test.ts`) with the canary under the lock (not across 21:00 UTC) | the money section's totals unchanged (no tie has a `win_id`); the parity test green on the release tree; wins metrics read "No wins yet" | previous versions and links |
| D-I1 | Apply `20261102i` | bucket private with its limits; `bank_receipt` and `reactivate` rows; purposes and origins; `cockpit_retire_items` seeded with 11.3's rows; `select cockpit_form_card_allows('86eywg1cq','bank_receipt')` NULL | saved bodies; the bucket and tables stay (empty) |
| D-I2 | Deploy `cockpit-forms-api` (on); guardian release (`checks/wins_cash.py`, `__init__.py`, its test) under its run lock | `file.url` with the service key 403; guardian checks read "not set up yet" | previous version and link |
| D-J1 | Apply `20261102j` | kickoff and onboarding version 2 present, registry still `typeform`, `forms.stage4` both false; option maps seeded with 9 fields; phase kinds in the CHECK; requests CHECKs | saved bodies; flags stay false |
| D-J2 | Deploy `forms-door` (off) and `clickup-writeback` (off, `forms.ts`, `run.ts`); native releases `hermes/client-messages` (file-scoped) and `hermes/csm-calls` (`sources.ts`); `hermes/forms-relay` installed with `FORMS_RELAY_APPLY=false`, its cron under `flock`; `hermes/ceo-refresh` `growth.js` file-scoped | forms-door probes as before (kickoff unsigned 401, signed probe 200); `FORMS_KEYS` absent = `checkin` only, the 1-1 notes writes unchanged; relay doctor ok, runs print "Nothing to relay."; kickoff cash in the growth section unchanged | previous versions and links |
| D-S1 | Ship client-success and media-buyer from the merged main, only after D-G1 to D-J2 | live bundle check; `to_regprocedure` non-NULL for every RPC the bundles name; every new door hidden (markers false); the Money tab Apply still present until D-LTV | `vercel rollback`; migrations stay |
| D-P1 | Portal release (after D-I1): `npm test`, `tsc`, commit on origin/main, `git archive`, `vercel deploy --prod --skip-domain`, CI, note the live id, `vercel promote`, `check-login-origin.mjs` 17/17, receipt `docs/releases/2026-11-0x-forms-w56.json`, `docs/CURRENT-STATE.md`, `VERSION.json` | `/preview/client-form?form=bank_receipt` 404 in production; staff preview of `bank_receipt` renders the tile in both languages and records nothing; Getting started still shows the Typeform embed (onboarding not live); `POST /api/forms/file` 401 without a session | `vercel promote <previous id>` |
| D-LTV | **LTV writer on:** pre-check: grep the saved blueprints of active Make scenarios **and the live billing-agent skill files** for `11d70e58` and an LTV field write (none expected in Make; the skill's `log_payment.py` write is the one known hit); confirm `convex/ceo/ltv.ts` `apply` and `setStartingFigures` still refuse first (`LTV_WRITER_RETIRED`) and `portal_billing_ltv_prepare` answers `hold` (revision 2); back up the skill folder (`~/backups/billing-agent-<date>-ltv/`), delete only `log_payment.py`'s LTV write (file-scoped), read the change back (the grep now counts 0); `BILLING_ONLY_CARDS=86eywg1cq` + kind `ltv`, `cockpit_billing_canary('ltv', {to: <test value>})`, read back, void, restore the test card's value by a second canary; clear the card list and run the held-edit review; deploy `cockpit-media-api` with the refusal; `billing.ltv.on=true`, marker `ltv` true (the Money tab Apply turns into the retirement line in the same minute); the next morning's run | the skill grep 0 after the edit; the canary item `delivered`; `ceo.ltv.apply` answers the retirement sentence; the 05:10 UTC run writes 2 events (Ardon, شركة العلا) and holds none; both read back on the cards; `ltv-drift` and `ltv-second-source` ok 2 days later | `billing.ltv.on=false`, marker `ltv` false (the Apply returns); remove `ltv` from the kinds; redeploy the previous `cockpit-media-api`; restore `log_payment.py` from the backup only if the morning writer stays off |
| D-CD | **Confirm paid moves the date:** a rolled-back DO block as the CEO that first inserts a fixture deal and a monthly `later` part for the test card `86eywg1cq` (and its mirrored Next Payment Date), confirms the part, reads the queued `date` item and RAISEs, so no row, queue item, notice or `pg_net` request survives (pg_net sends only after commit); the same cases are proven in PGlite (8); then `billing.confirm_date.on=true` | the rolled-back block shows one `date` item one month on, for the test card only; the first real confirm is watched and read back | `billing.confirm_date.on=false` |
| D-AG0 | **The agent's reach (read only):** the inventory of 4.5.1: every file the agent's Unix user and runtime can read that holds a Supabase key name, and the Unix user of each worker that sources those files; paths and key names only, in the deploy log | the list, and the verdict: separation possible (the agent can be moved to its own user or runtime without breaking another worker) or not | none |
| D-AG | **The agent's login:** read and save the live skill files (`~/backups/billing-agent-<date>/`); map every Supabase REST call to a 3.4 op or read and list every ClickUp call (stop if a write has no op); generate the key on the VPS (`openssl rand`, written into the agent's **own** env file, `chmod 600`, as `MAHARA_AGENT_KEY`, never printed), send only its sha256 to `cockpit_agent_key_put_owner('billing_agent', <sha>, 'D-AG', <who>)`; copy `cockpit_agent.py`, re-point the skill's writes, remove its ClickUp writes; `cockpit_agent.py doctor`; remove the Supabase key entries from the agent's own env and skill; when D-AG0 said separation is possible, move the agent to its own user or runtime and make every file holding a Supabase key unreadable to it (other workers' next runs read back), then `billing.agent.separated=true`; otherwise leave it false and write "AG is not achieved: the agent can still read the old key on the server" in the deploy log; freeze the Google Sheet "Payments" tab (protect the range; the CEO's sheet, read back; C8); marker `agent` true | doctor ok; the D-AG0 list run again as the agent's user shows zero files with a Supabase key name (achieved) or the stated "not achieved" line; zero ClickUp write calls in the skill; the agent's next scheduled run writes its `chase` events through the door (`cockpit_agent_calls` rows `ok`, events source `maher`); the Payments tab protected; the CEO card shows the key, last call and, if not separated, its warning | restore the saved skill folder and env from the backup; revoke the key; unprotect the Payments tab |
| D-W | **Wins live, C7 (one hour):** note the window start and `cockpit_billing_writeback_held(<open kinds>)`; `BILLING_ONLY_CARDS=86eywg1cq` + kind `win`; canary: a `review` win on the test card through a rolled-back seat block is not enough for the card, so `cockpit_billing_canary('win', {...})`, the comment read back, void; clear the card list, held-edit review; `wins_backfill.py --dry` then without (it writes no notice, comment or billing event, 4.2.4); marker `wins` true, `pay.proposals.on=true`; then 4.7's switch-offs (Typeforms closed, webhooks removed, Make off, sheet tab "04" frozen, `win.logged` enabled last); retire rows updated | the five scenarios `isActive=false`, five forms closed, webhook lists before/after saved; 35 (or the counted number) void wins, none in pay, no notice posted for them; `heldOpenKind` 0; the first real Log a win watched (D-Z) | marker false, `pay.proposals.on=false`, kind `win` out; scenarios on from blueprints; forms reopened from definitions; webhooks re-added; each retire row back to `on` through `cockpit_retire_item_set` with the note and step |
| D-BR | **Bank receipt live:** canary `cockpit_form_invite_canary('bank_receipt', {part:'payment', expectedAmount: 1, currency:'KWD'})`, open the link in the built-in browser, upload a test image (a plain teal square made locally), submit with the typed name "Mahara test" → shadow answer, one inbox row on the test card written `rejected` "Canary on the test card" (4.10.3, so ingest never takes it), the receipt opens through `file.url` in the built-in browser, `receipt.in` muted; `cockpit_form_client_go_live('bank_receipt', true, 'deploy D-BR')`; enable `receipt.in` | each read-back; the canary inbox row `rejected` and absent from `cockpit_manual_payments`; the live list includes `bank_receipt`; Ask for the receipt appears | go-live off (withdraws open requests); disable the notice |
| D-RA | **Reactivate live:** `BILLING_ONLY_CARDS=86eywg1cq` + kind `reactivate`; `cockpit_billing_canary('reactivate', {...})` (Active, churn fields cleared), read back, then a `churn` canary returns the test card to its stopped test state, void both; clear the card list, held-edit review; marker `reactivate` true; enable `client.reactivated` | card fields read back; `heldOpenKind` 0 | marker false; kind out; notice disabled |
| D-C9 | **The retire list (one window):** for each C9 row of 11.3 whose step is `D-C9`: save, switch off / close / remove, read back, set its registry row (`cockpit_retire_item_set`) with the backup path; then on any later deploy day archive the `ready` rows (4.11) | each item's state and read-back in the deploy log; nothing deleted | per row: switch back on from its saved blueprint, reopen from its saved definition, re-add the webhook, and move its registry row back to `on` (`cockpit_retire_item_set` with the note and the rollback step, 3.7) |
| D-S4.0 | **Stage 4 groundwork (run 2026-11-02; stopped on three differences, 11.8):** the test card's internal WhatsApp group and Client Data row were not there yet (1.3; now needed before D-S4K). Done: the blueprints of `8925654`, `8922994` and `8979157` saved to `~/make-backups/{id}-before-s40-20261102s40.json` and the definitions of `tG7dnxBn` and `KFRCXPFx` to `~/typeform-backups/` under the same names, with their webhook lists; Make 12 [24] is `google-sheets:filterRows`, a search on Client Data column C, so no extra effect; `KFRCXPFx`'s `logic` has one jump, a single equality on an earlier field, which fits `showIf`; `cockpit_form_option_maps` equals Make 12 [21]'s `switch()` on 47 of 47 answers; `onboarding.map_urls` filled for phases 3 and 4 (from Make 13 [49] and Make 12 [26]) and read back on the test card. Found: Make 13 [31] is a search too, so `client_data_row` is a write Make never makes (X34); the phase 3 and phase 4 texts end with the client's content folder link from Client Data column H (X35); `make_parity.py` cannot read Make's executions (X36). Held for D-S4F: `stage4.messages`, the relay config, the `brand_dna` and `client_onboarding` request types, the parity run | the deploy log's "D-S4.0 groundwork" section: each save, the [24] module type, the logic jump, 47 of 47, the map read-back; the three differences fixed on branch `forms-s4-fixes` | none needed: nothing changed in Make or Typeform, and `onboarding.map_urls` is read only by the Stage 4 planner |
| D-S4F | **Stage 4 fixes, after branch `forms-s4-fixes` is reviewed and merged (X34 to X37), and only once the open items of 11.9 are done on it:** (0) **The oracle run** (4.15.5; the Mac, read only) on the merged tree, before anything is applied. (1) **`20261102l`:** the letter rule (live held `j` and `k` on 2026-11-02, so `l` was free); `python3 scripts/dev/forms-deploy/guard_check.py supabase/migrations '20261102l*'` (widened on this branch to match function names with digits; read 2026-11-02: `n` 2, `live` 2, `odd` null), live must be `afa3e203…` and `a704e72a…`; save `before-cockpit_form_stage4_effects.sql`, `before-cockpit_form_stage4_build.sql`, the two outbox CHECK definitions and the onboarding registry `effects`; `mig.py dry` then `mig.py apply`. (2) **`20261102m`, right after (1)** (2.9): the letter rule again (2026-11-02: live held `a` to `k` and no branch held `m`, but the worktree `goals-sheet` holds an untracked `20261102m_goal_sheet_truth.sql`; if that file reaches live or main first, this one takes the next free letter on its branch and 2.1 is amended before the apply); `guard_check.py supabase/migrations '20261102m*'` (read 2026-11-02: `n` 6, `live` 5, `odd` the builder; after (1) the builder must read `l`'s after `7e5f7fda…` and the other five their live values); save `before-` of the six functions 2.9 replaces; `mig.py dry` then `mig.py apply`. (3) **`onboarding.raw_titles`** = `scripts/dev/forms-deploy/stage4-raw-titles.json` from the merge, as it is (owner SQL, `updated_by` `deploy D-S4F`), right after (2). (4) **client-messages release** (file-scoped, `hermes/client-messages/RUNBOOK.md`): staged doctor and dry run, link swapped under the worker lock; `CLIENT_MESSAGES_KINDS` unchanged. (5) **`cockpit-forms-api`** (phase drafts approvable, 11.8, 11.9): `fdeploy.sh cockpit-forms-api <merge rev> --dry`, then live with `--verify-jwt` equal to the live value (read it again; W34 read `on`); then `scripts/ship.sh client-success` from the merge (the Messages card draws `{content_folder}` as the Client Data link and counts a phase text to 1,500; the kickoff sheet with its questions stays behind `forms.stage4.kickoff`). (6) **`clickup-writeback`** with the request writer's task comment step and the text cap of 11.9: `fdeploy.sh clickup-writeback <merge rev> --dry`, then live with `--verify-jwt` equal to the live value (W34 read `off`). (7) **forms-relay release** of the new files (`hermes/forms-relay/RUNBOOK.md`); `~/.forms-relay/config.env` holds only `DISPATCH_OWNER`, `DISPATCH_REPO`, `DISPATCH_EVENT`, `DISPATCH_NAME_KEY` and `DISPATCH_ID_KEY`, from Make 13 [25] in the saved blueprint (no `CLIENT_DATA_*` line; the relay holds no Google key); `GITHUB_DISPATCH_TOKEN` in `keys.env` is still the CEO's to add; `FORMS_RELAY_APPLY=false`; then the guardian's `checks/wins_cash.py` released under its run lock (the `relay` check now names only the dispatch). (8) **`stage4.messages`** = the two templates of X35, verbatim from `MESSAGES` in `apps/media-buyer-cockpit/scripts/stage4-content-folder-supabase.test.ts` (owner SQL, `updated_by` `deploy D-S4F`), only after (4) is live. (9) The fills D-S4.0 held: the request types `client_onboarding` (two targets, 4.13.3) and `brand_dna` (4.14.3; no template, as Make 13 [46]) through `cockpit_request_type_add`, the ClickUp Request Type option added first. (10) `make_parity.py kickoff` and `make_parity.py onboarding` on the VPS from the merged file | (0) the harness's last lines: `PASS` for onboarding; for the kickoff every effect `equal` or `intended`, `onboarding_tasks` included (the writer posts the comment and the plan carries no details), and `onboarding_tasks_runner` equal, on both hidden-value passes; the deploy log keeps counts and verdicts only. (1) both md5s read the after values `1b01ccc5…` and `7e5f7fda…` (`guard_check.py` again: `after` 2); the outbox CHECKs read `effect_key = 'github_dispatch'` and the `github_dispatch` dedupe pattern; the onboarding registry `effects` equal `cockpit_form_stage4_effects('onboarding', 1)` (the go-live drift check's condition), neither onboarding array holds `client_data_row`, the kickoff arrays are unchanged; one audit row `forms.stage4_no_client_data_row`; both ACLs owner only. (2) `guard_check.py … '20261102m*'`: `after` 6; the ten functions of 2.9 owner only (no EXECUTE for PUBLIC, anon, authenticated or service_role); `cockpit_requests.task_comment` exists; `cockpit_form_stage4_fields('kickoff')` holds 46 entries and `('onboarding')` 36; `onboarding.raw_titles` reads `{}`. (3) its `fields` hold 36 entries whose refs, in order, and titles equal the file's (compared on the Mac; print counts and booleans only). (4) doctor ok; `run.sh doctor --task 86eywg1cq` prints `driveLink` (it must read `present` before any canary); a run prints "Nothing approved to send.". (5) the function's version and `updated_at` moved, `verify_jwt` unchanged; `ship.sh`'s own checks pass; the phase approve itself is proven by D-S4K's canary. (6) version and `verify_jwt` read back; the request writer's tests green on the merge. (7) the doctor names no Client Data line and no Google key, only what is still missing (the token); a run prints "Nothing to relay.". (8) `cockpit_form_stage4_message('phase3' / 'phase4', <the test card's client>, cockpit_form_stage4_map_url(3 / 4, '86eywg1cq'))` returns a `body` and no `missing`: the map link filled, `{content_folder}` kept exactly once, 1,500 characters or less (print booleans and lengths only). (9) both types listed with their targets. (10) `PASS` for both forms; each `differs` of 11.8 and 11.9 gone, or recorded as intended in 11.1 first, with the CEO's word (X37) | (0) none: it only reads. (1) the saved bodies, both CHECKs from their saved definitions and the registry `effects` from the saved array, in one transaction (a body without its matching array fails the go-live drift check), and only after (2) is rolled back. (2) the six saved bodies in one transaction; `task_comment` and `onboarding.raw_titles` stay (only `m`'s bodies read them). (3) `onboarding.raw_titles` back to `{}` (the raw answers comment then fails with its sentence). (4) the link back to `b7ab2d11` (no phase kind is listed, so nothing sends a template). (5) `cockpit-forms-api` back to its previous version (its rev recorded before the deploy), so phase drafts cannot be approved; the cockpit back to its previous deployment. (6) `clickup-writeback` back to its previous version (the onboarding tasks then get no comment). (7) the link back to `b7ab2d11` (after (1) the outbox holds no Client Data row for its old path to write); `config.env` back to empty; the guardian's previous `checks/wins_cash.py`. (8) `stage4.messages` back to `{}`. (9) the types stay: only the Stage 4 planner files them, and it runs for no real card before a go-live. (10) a `FAIL` or `NOT PROVEN` stops Stage 4: fix on a branch, deploy it the same way, run (0) and (10) again |
| D-S4K | **Kickoff native (one hour), only after D-S4F passed (the oracle run and the VPS run, the phase approve deployed, the request writer posting the task comment; 11.9):** note the window start; `run.sh doctor --task 86eywg1cq` (client-messages) reads `driveLink present`; `CLICKUP_WRITEBACK_FORMS_KEYS=checkin,kickoff`, `CLICKUP_WRITEBACK_FORMS_ONLY_CARDS=86eywg1cq`, `CLIENT_MESSAGES_KINDS` + `phase4` with `CLIENT_MESSAGES_ONLY_CARDS=86eywg1cq`, `FORMS_RELAY_APPLY=true`; canary kickoff submit on the test card as the CEO's seat: every effect read back (the handoff comment, its text before the writer's ref line byte-equal to the plan's; status; the nine fields, Service Advertised the option ticked first; Blueprint link; map URL; two tasks made, each with one comment byte-equal to the handoff before its ref line, then cancelled through `cockpit_request_cancel` with the reason "Canary on the test card"; the phase 4 draft approved and **sent to the test card's internal group** with the test card's content folder link in place of `{content_folder}`, and read back, notice muted, `mrr` voided); clear the card lists; `cockpit_form_stage4_go_live('kickoff', true, ...)`; edit Make `8979157` module [45] so its Kickoff Form Link `87d7d889` is the cockpit kickoff link (blueprint saved, only that value changed, diff read back, the scenario stays active); save and close `tG7dnxBn`, remove `WHTP3992232` and the `postcallsummary` webhook on it (lists before/after), switch off Make `8925654` (read back) | the parity record from D-S4F linked in the log; each canary read-back; registry native with the version-2 array; the [45] diff; scenario off; the first real kickoff watched (D-Z) | go-live off (version-1 array back); scenario on from its blueprint; 8979157 restored from its blueprint; form reopened; webhooks re-added; kinds and keys back |
| D-S4O | **Onboarding native (one hour), only after D-S4F passed (the phase approve deployed, `onboarding.raw_titles` filled; 11.9) and the CEO has looked at the drafted questions (1.3):** keys + `onboarding`, kinds + `phase3`, card lists narrowed to the test card; canary `cockpit_form_invite_canary('onboarding', ...)`, answer by link in the built-in browser, every effect read back (the profile text byte-equal to the plan's; kickoff link; the raw comment, its text before the writer's ref line byte-equal to the plan's, with the full titles; map URL; Brand DNA request made then cancelled the same way, the phase 3 draft approved and sent to the test card's internal group with its content folder link, read back; nothing written to Client Data; GitHub dispatch: relay dry print compared with the blueprint's body, its client name the typed Business Name, not sent for the test card); a signed forms-door probe with a recorded `KFRCXPFx` payload rewritten to the test card shows it is stored `legacy` (the card is already answered) with no effects; clear the lists; `cockpit_form_stage4_go_live('onboarding', true, ...)`; remove `WHTP3991048` (Make's hook) and switch off Make `8922994` (read back). `KFRCXPFx` **stays open** and Make `8979157` [40] is **not changed** (X26): its link now feeds the native planner through forms-door | each read-back; the portal's Getting started shows the native form for a staff preview; the first real native onboarding answer (portal or Typeform door) watched: its relay row `sent` (market intel dispatched), its phase 3 message sent with the card's content folder link (D-Z) | go-live off (the embed returns, version-1 array back); 8922994 on; webhook re-added |
| D-Z | Watch the first real press and answer of each piece: Log a win, Mark as offered, Accepted, a tie (CSM and CEO), a pay proposal confirm, the morning LTV run, a Confirm paid that moves the date, the agent's door calls, a client receipt and its check, a Reactivate, a native kickoff, a native onboarding; write the session note | one line each in the deploy log | per piece's runbook row |

Rows run top to bottom; the go-lives (D-LTV onward) only after D-S1 and D-P1; D-S4K and D-S4O only
after D-S4F passed and on different days (one Make switch-off window a day).

---

## 10. What waits on the CEO or on people

- **Q4 (from wave 4):** the bot invite to #nps-survey-feedback; NPS and CSAT stay on Typeform until then (their rows in 11.3 read `on`, step `W34 D-C5`).
- **A finance seat:** none exists, so receipt checks, `payment_receipt_check` and tie confirms all route to the CEO until he adds the role.
- **Arabic wording:** every client line in section 5 was drafted under the voice skill and is used as is; the CEO edits client forms in the forms editor. The phase 3 and phase 4 WhatsApp texts are his existing Make texts, moved unchanged; the content folder link Make took from Client Data column H is put in at send (X35).
- **First real presses and answers** (D-Z): watched, never imitated.
- **The 14 quiet days:** the scenarios switched off on 2026-11-01/02 (C1, C2, C4b, 2b) become archivable from 2026-11-16 if nothing came through; the C7 and C9 ones 14 days after their window.
- **Liwan-style history and the 21 Stopped cards without churn fields** stay as W12 left them (a CSM review list).
- **The New Client Form** is unchanged by decision X16, a departure from the literal Q21 default ("Add a New MRR question to the New Client Form? Yes, at Stage 4") and from the CEO's 2026-09-21 words "new MRR as well, on the closer, on the form": the question is asked on the native kickoff instead, because Make 8979157, Cortana, HighLevel and B2B read the New Client Form and a submission must never be imitated to test it. If the CEO wants it on the sale form too, it is a Typeform edit with those mappings checked first. Recorded in the plan's section 10.
- **The native onboarding invite at signing (X26):** Make 8979157 [40] keeps the `KFRCXPFx` link until form invites go by WhatsApp with the CSM's approval (`form_invite` in `CLIENT_MESSAGES_KINDS`); then [40] carries the native invite and `KFRCXPFx` closes (its retire row waits on that step).
- **AG separation (X27):** if D-AG0 finds the billing agent shares a Unix user with workers that need the service key, a separate user or runtime for the agent is a systems step; until then the CEO card and the guardian say the agent can still read the old key.
- **The test card's internal WhatsApp group** (1.3) and its Client Data row with a content folder link in column H, before D-S4K, and **the CEO's look** at the drafted onboarding questions before D-S4O.
- **Match Make (X37): what cannot match without his word** (11.9). (1) The ref line the writer adds after every Stage 4 comment (`Cockpit ref F-…`, so a comment is never posted twice): keep it, or have the writer find its comment by the full text instead, a weaker guarantee. (2) What the request path adds to the three tasks Make makes (the task name `{client} - {type label}`, a description holding the request marker and, on the onboarding tasks, the template's text, a due date, a priority, owners by rule on the onboarding tasks, the client tag, the Request Type field, a link comment on the client card per task): keep the requests and record these as intended in 11.1, or make the three tasks with direct ClickUp writes as Make does. (3) The phase 3 map and message for a card with no Client Data row or several (Make acts once per row; the cockpit moves the map once and sends only for exactly one row). Until he answers, 11.9 lists them as differences; the parity run does not grade them (it reads the plan), except the task name, which `make_parity.py` still reads as intended.

---

## 11. Decisions and checked facts

### 11.1 Decisions this contract makes (X-numbers), with reasons

| # | Decision | Why |
|---|---|---|
| X1 | Migrations `20261102g` to `j`; no portal database migration | Live holds `a` to `f`; nothing holds `g` or later (11.2-a, b); the portal reaches business data only through `portal_*` RPCs and Storage with its service key. |
| X2 | Upsell stage codes stay the plan's (`quote_given`, `signed`, `paid`, `void`), shown as the brief's words Offered, Accepted, Paid | The plan's codes are approved (E11, 5.6); the CEO's brief names the same three steps in plainer words. "Accepted" needs a signed agreement (5.6: a proposal marked accepted stays `quote_given`). |
| X3 | A payment ties to one win at most (unique index); a win tie is always a payment tie to the win's card | "Upsell cash is attributed once": one payment cannot be counted for two wins, and the card target keeps the back-end credit on the card's CSM. |
| X4 | The CSM proposes a win tie; the CEO confirms; only a checked payment can be confirmed | Plan 5.6 default and E8 (only money that arrived counts). |
| X5 | Pay proposals are derived on read from the ledger; only the CEO's decision is stored, and a confirm writes an ordinary pay entry through the existing save path | Keeps `cockpit_pay_compute` (the pay authority, memory pay-plans) untouched; a proposal can never drift from its win; E12: nothing pays itself. |
| X6 | C7 "retirement of the old typed steps" = the five Four Rs Typeforms and scenarios off, the CSM's typed counts replaced by "From your wins", and a typed pay entry for a win-backed part needing a `win:` reference or a stated reason | Plan 5.7's C7 plus E12; the CEO keeps a door for a win the ledger missed, with its reason in the audit. |
| X7 | Proof is a link in v1 (no staff upload) | FormSheet has no file field and the plan lists links or screenshots; a screenshot link (Drive) carries the same proof without a second upload path. |
| X8 | The LTV writer is the `ltv.preview` rule over checked money, written daily through billing kind `ltv`; jumps over $5,000 wait for the CEO | E10; the preview rule is already the CEO's chosen LTV ("Number two", SOURCES.md:125); the cap stops a bad refresh from rewriting every card at once. Live dry run: 2 writes, Ardon +2,000 and شركة العلا +21.20 (11.2-j), matching plan 5.3. |
| X9 | The agent login is an Edge Function door with a key whose sha256 alone is stored, not a Postgres JWT role | The plan allows either; minting a role JWT needs the project's JWT secret, which no session holds; the door gives rate limits and health-ledger lines, and the raw key never leaves the VPS. |
| X10 | Confirm paid moves the date only when the confirmed part is the one due on the card's date (±7 days): to the next later part's due date, else +1 month on a monthly plan, else not at all | Moving the date on a payment that was not the due one is the drift E2 ends; the rule never guesses a period. |
| X11 | A receipt for an already logged transfer attaches as evidence; only a receipt for a part with no logged payment becomes an inbox row | Otherwise one transfer would be logged twice; the ledger's protect trigger forbids editing the logged row, so evidence lives beside it. |
| X12 | Reactivate is the returning-client act the CEO's brief describes; it clears the card's churn fields but never removes the departure | The month the client left keeps its churn (pay bands, lock-in, churn rate); the card shows the client as live again; the old churn stays in the comment and the register. |
| X13 | The "Reactivate your ads" form (5.18) is not built; its Typeform closes in C9 | No webhook, nothing reads it, the ad-billing guard decides, and its payment-id table was never checked (plan 5.18 "Size: M. The guard's payment-id table has not been checked"). |
| X14 | Archive only what is already off and quiet 14 days, by moving it to "09 Archive"; never delete | E19 and the plan's 14-day rule; the archive folder is empty today (make-inventory 2), so moved items stay findable. |
| X15 | The kickoff becomes a native staff form in the CSM cockpit (FormSheet), not a portal page; the onboarding becomes a native client form in the portal renderer | The CSM types the kickoff on the call (plan 5.12, "Stage 4: native in FormSheet"), and it carries internal answers (payment amount, call recording, contract status) a client must not see; the onboarding is the client's own form (plan 5.16, "a native page in the portal renderer"). |
| X16 | The New MRR question (Q21) goes on the native kickoff, not the New Client Form. **This departs from the literal Q21 default** ("Add a New MRR question to the New Client Form? Yes, at Stage 4") and the CEO's 2026-09-21 words ("new MRR as well, on the closer, on the form"); recorded as a departure in the plan's section 10 | The brief places it on the kickoff; the New Client Form feeds Make 8979157, Cortana, HighLevel and B2B and must never be imitated or changed lightly (memory new-client-form); the kickoff is the first cockpit form after the sale, so no new question is opened on the sale form. |
| X17 | Parity is proven on recorded Make inputs (the cockpit plan equals each module's input bundle, intended differences listed) and on the test card, before a switch-off in the same hour (the recorded inputs are now the stored answers, X36) | "Parity of every Make effect before each switch-off" with no live submit: the executions Make already ran are the recorded payloads. |
| X18 | Phase 3 and phase 4 WhatsApp messages become client-messages drafts the CSM approves | The 2b rule: a person approves every client message; an intended difference listed in parity. |
| X19 | The GitHub dispatch goes through a VPS relay (the Client Data row was dropped, X34); the sheet is not replaced in this wave | The client-messages worker and four scenarios read that sheet's column F today; replacing it is its own piece. |
| X20 | Map URLs, phase texts, the dispatch target and the dropdown maps are data filled from the saved blueprints at D-S4.0 (the phase texts, the dispatch target and the request types at D-S4F) | Builders cannot read Make; the deploy reads the blueprints once and the parity script proves the values. |
| X21 | Every new writer is dark at deploy; door markers seeded false and flipped at each go-live | The brief's rule; a screen never shows an act whose writer is off. |
| X22 | Win and reactivate card writes ride the billing rails (kinds `win`, `reactivate`) | W34 V4: per-kind switch, card canary, read-back, held-edit review and audit already exist there. |
| X23 | Three notice kinds only (`win.logged`, `receipt.in`, `client.reactivated`) | The old Four Rs scenarios posted to #csm-announcements; receipts go to the team that checks; Make 13 posts nothing, so onboarding adds no notice. |
| X24 | The onboarding draft lives in the browser's `localStorage` for 7 days (answers only), and the intro says it is kept on this device | The form takes about 10 minutes, possibly over several sittings, and the plan wants "come back to it"; W34's 1-hour `sessionStorage` draft is too short and 24 hours would break the intro's promise; nothing secret is stored on the portal path. |
| X25 | Inside D-LTV, in this order: the agent's `log_payment.py` LTV write is deleted (backed up, read back), the refusal of `ceo.ltv.apply` deploys, then `billing.ltv.on` and the marker `ltv` turn true; the Money tab Apply shows until that marker is true | One LTV writer at every moment: before D-LTV the CEO's Apply is the one deliberate writer (the agent's at-logging write is the second writer of today, and it is removed first, in the same step, not at D-AG); after D-LTV the morning writer alone. Never zero, never two. |
| X26 | After the onboarding go-live, `KFRCXPFx` stays open and Make 8979157 [40] keeps sending its link; forms-door feeds its deliveries into the same native planner (`cockpit_form_onboarding_typeform`), once per card | Most new clients have no portal session at signing (E1: 6 of 8) and form invites do not go by WhatsApp yet (memory forms-waves-3-4-live), so swapping [40] to the portal home would leave them without a working link. Feeding the Typeform into the native planner keeps one set of effects with no Make, and needs no imitated submission. [40] moves to a native invite when `form_invite` goes by WhatsApp (section 10). |
| X27 | AG counts as achieved only when no file the agent's runtime can read holds a Supabase key; otherwise the door is used and "not achieved" is said plainly | `/opt/data/bibi/api-keys.env` is shared by other workers (client-messages, cockpit-ask-ai, sales-desk); deleting the key there breaks them, leaving it lets the agent read it. A scoped login that the agent can bypass protects nothing, and the CEO should not be told otherwise. |
| X28 | The bank receipt's date trigger (E20) is a Today band, not a scheduled send | A due part with no money yet may be paid by card (Whop, Tap, Ecom) in a day; a scheduled receipt request would ask card payers for a bank receipt. The CSM sees `Payment due {date}, no money in` and sends it in one press. |
| X29 | A checked receipt moves the next payment date through Confirm paid (a Today band on the part), not by a new trigger on the check | Plan 5.17 says the date moves through billing kind `payment` after the check; the cockpit's one date-moving act since W12 is Confirm paid (4.6, one date write per save). A trigger on `cockpit_manual_payment_check` would replace a live W12 RPC and could write a second date for one save. |
| X30 | Reactivate needs a confirmed departure; a Stopped card without one is refused with "Confirm the churn first" | The departure register is what keeps the month they left counted (X12); a reopen without it would have no left-on day, no reason and nothing to mark returned. |
| X31 | A win tie cannot take cash already paid to the closer or the setter in an approved month (an approved month whose frozen result lists the payment, or the deal ledger row now or as recorded on the tie when the CEO confirmed it), and cannot be cleared once the CSM was paid for it in an approved month | Approved months are never rewritten (memory pay-plans), so either move would pay the same cash twice. The CEO keeps the typed entry with a reason (4.9) for a real exception. |
| X32 | A pay proposal whose month is approved is confirmed into the first open month, carrying its own month in the note | Wins can be logged up to 30 days back and months approve from the 3rd; refusing would leave the proposal stuck and push the CEO to typing (against E12). The proposal key keeps it to one payment. |
| X33 | Tie candidates exclude only a deal's own contract money (deposit rows, Whop deal link, payer tie); a rule-2 card-match remainder is a candidate, shown with "counts for the closer now" and needing the CEO's reason | Q23's day-30 upsell is exactly a rule-2 card match; excluding every deal-ledger row would make it untieable, while the reason and X31 keep closer money from moving silently. |
| X34 | The native onboarding writes no Client Data row: `20261102l` takes `client_data_row` out of the planner, both onboarding arrays and the relay outbox, and the relay sends only the market intel dispatch (D-S4.0) | Make 13 [31] is a search, not a write, and no Make scenario writes a Client Data row; appending one would be a write Make never made, and the client-messages worker already reads the card's row itself. |
| X35 | The phase 3 and phase 4 texts keep `{content_folder}`; the client-messages worker puts in the card's Client Data column H link (Google Drive Link) at send, as it does `{form_link}`, and refuses the message with a sentence when the link is missing or not a link (D-S4.0) | Make 13 [48] and Make 12 [25] end with that link; the approved text and its fingerprint stay the template, the link goes only into the one send, and Make's blank line on an empty cell is never copied. |
| X36 | Parity runs the saved blueprints' expressions on the answers the cockpit stored, and proves that evaluator against the comment ClickUp holds on each card (D-S4.0) | Make's API returns no module bundles (a log is a summary, an execution only a status), so the old script could only print `differs`; the stored answers are Make's own inputs, and the card's real comment is a second source on every run. |
| X37 | **The CEO's decision, 2026-11-02: "Yes, match Make".** For the same answers the native kickoff and onboarding write what Make 12 (`8925654`) and Make 13 (`8922994`) write, byte for byte where Make writes text. `make_parity.py`'s evaluator (X36) is the reference; `20261102m` builds Make's texts and choices in SQL (2.9). Intended entries that only described what the cockpit did differently are withdrawn (11.9); where something cannot match, 11.9 says exactly what and why, and it becomes intended only with the CEO's word (section 10) | The CEO decided it on the differences of 11.8. The evaluator equals the comments ClickUp holds on 12 of 12 real cards, so equality with it on the stored answers is equality with Make. |

### 11.2 Checked for this contract (read only, 2026-11-02)

- **a** `select name from supabase_migrations.schema_migrations where name like '202611%'`: `20261101a` (two) to `r`, `20261102a` to `f`.
- **b** `git ls-tree --name-only origin/main supabase/migrations/` and every local and remote branch, plus every worktree under `mahara-worktrees` and the shared checkout: no `20261102g` or later and no `20261103*`.
- **c** `md5(regexp_replace(prosrc,'\s+',' ','g'))` and `proacl` for every function in 2.2, as listed; `pg_get_viewdef('cockpit_client_lifecycle_v')` md5 `43a401c28835ecd33b5c5c545eaa86cd`; `cockpit_ceo_refresh_finance_snapshot` md5 `742d03b03c8112a3fbf94ef506d8ee81` with ties as `to_jsonb(t)`.
- **d** `cockpit_forms`: 16 rows; native: blueprint, checkin, churn_confirm, csat, exit_survey (v2), extension, mrr, nps, pause, pause_consent, portal_feedback, resume; typeform: kickoff `tG7dnxBn`, new_client `BTzMwXiw`, onboarding `KFRCXPFx`, pause_request `CTUjv6l3`. Kickoff effects: `handoff_comment`, `onboarding_tasks`, `card_fields`, `map_phase4` (clickup_queue, make), `phase4_whatsapp` (client_message, make), `kickoff_notice` (slack_notice, cockpit), `recap` (shadow). Onboarding effects: `card_fields`, `client_data_row` (sql), `phase3_whatsapp`, `brand_dna_task`, `github_dispatch` (sql), all make.
- **e** Settings: `billing.daily {"on":true}`, `billing.ladder {pauseReviewDay 4, cancelReviewDay 15}`, `billing.mrr_tolerance {pct 10}`, `forms.client {"live":["pause_consent","exit_survey","portal_feedback"],"presence":true}`, `forms.doors` `checks, churn, editor, invites, lifecycle, money, voice` all true, `forms.schedule.on false`.
- **f** CHECKs: billing events kinds `amount, assign, chase, churn, confirm, date, exclude, extension, invoice, late, link, ltv, method, mrr, note, pause, payment, plan, resume, unconfirm, unexclude, unlink, survey, nps_sent`, sources `ceo, clickup, csm, maher, system`; inbox sources `csm, maher, other`, methods `bank_transfer, cheque, cash, tap, other`; invites purposes `pause_consent, exit_survey, nps, csat`, origins `csm, schedule, pause, churn, canary`, `purpose = form_key`; client messages kinds `recap_checkin, recap_kickoff, recap_blueprint, phase5, form_invite`; requests sources `requests_page, client_page, import`; responses sources include `portal`; pay entries `part_key ~ '^[a-z][a-z0-9_]{0,39}$'`, `evidence_ref` ≤ 200.
- **g** Trigger `cockpit_billing_events_clickup_writeback` WHEN: ceo/csm `method, plan, amount, date, extension, pause, resume, payment, note, churn, mrr`; system `extension, ltv, late, survey, nps_sent`.
- **h** Money tables: `cockpit_pay_entries` 0 rows; `cockpit_payment_ties` 8 (all live, no `win_id` column); `cockpit_billing_confirmations` 1; `cockpit_upsell_wins` 0 (the client's own win, unrelated); `cockpit_deal_payments` 77 active; `cockpit_upsell_proposals` 10, all `draft`; `cockpit_manual_payments` 8, all `checked` payments, $21,239.16; billing events from `maher`: chase 176, invoice 35, date 4, payment 2 (the `date` and `payment` rows predate W12 C1 and the inbox; 3.4).
- **i** `cockpit_churn_departures`: 6 rows, none removed; columns end `confirmed_by, confirmed_at, billing_event_id` (no return columns). `cockpit_billing_accounts` statuses: Stopped 31, Active 15, SALES TEAM TO CONTACT 14, GHOSTED 5, Brand Blueprint Booked 3; no `plan` column (the plan is `payment_plan`).
- **j** LTV dry run (the `ltv.preview` query with `coalesce(t->>'checked','true') <> 'false'`): 23 eligible cards, 19 ready, 4 missing a baseline; writes only شركة العلا 4,000 → 4,021.20 and Ardon 2,000 → 4,000. The money section (`cockpit_sections` money, computed 2026-11-02 05:34 Kuwait) holds 788 transactions, every one with `checked`, none `false`, so the stricter filter of 4.4.1 (`checked` IS TRUE, a missing key refuses the run) gives the same two writes.
- **k** Plan 5.7 and make-inventory 3: Four Rs responses 4 (`ETEynRgb`), 8 (`bAmbMKM2`), 8 (`cKItPZVI`), 12 (`VP3zmaj2`), 3 (`IVHO9BMC`) = 35; webhooks `WHTP4096883`, `WHTP4105426` (+ phoenix off), `WHTP4105956`, `WHTP4108828`, `WHTP4112950`; scenarios `9169735`, `9188441`, `9190294`, `9195843`, `9205789`, all on with 0 runs in 30 days on 2026-10-25.
- **l** LTV writers: `supabase/functions/cockpit-media-api/ltv.ts` (`ceo.ltv.apply`, CEO-pressed, through `cockpit_ceo_action('ltv.preview')`); the billing agent's `log_payment.py` (VPS, memory client-billing-sheet, plan 5.3); the portal's `src/lib/billing-ltv.ts` (gated by `MAHARA_BILLING_LTV_SYNC_ENABLED`, unset); no Make scenario writes LTV (make-inventory section 5 card-field writers, 202 blueprints, 2026-10-25).
- **m** `cockpit_clickup_fields` (103 rows, read 2026-11-01 23:15): Client Status options `Active, Paused, Ready For Launch🚀, LAUNCH BOOKED, Brand Blueprint Booked♠️, Onboarding Booked, Needs Contacting, CANCELLED ONBOARDING, DELAY OUT OF OUR CONTROL, SALES TEAM TO CONTACT, GHOSTED, Stopped`; the nine kickoff dropdowns stored with options (`924bba47` 4, `a1520ef3` 7, `ac976d4a` 5, `bab9a58b` 6, `bc7e70a2` 7, `cc14ad2d` 6, `d113cd99` 4, `e7d158a8` 4, `f0a20cef` 4); `1b7a4a74`, `51f49cb1`, `87d7d889` URL fields; `7755485f` text; `48eb6023` MRR currency.
- **n** No seat holds the `finance` role (W12 deploy log, memory forms-waves-1-2-live: "payment_receipt_check routes to the CEO").
- **o** Stored answers: `cockpit_client_onboarding` 70 rows, 30 with `forms.kickoff` `{form_id, answers (38 refs), response_id, payment, submitted_at, recording}`, 42 with `forms.onboarding`; `cockpit_form_responses` kickoff 8 (pointer rows, 89 bytes), onboarding 46 (`answers.fields` 33, each `{ref, title, value}`), new_client 55.
- **p** Make parity sources: make-inventory 4.2 (8922994: [25] GitHub `market_intel`, [29] Client Profile + Kickoff Form Link, [47] raw comment, [31] Client Data row (D-S4.0 read it as a search, X34), [49][50] map phase 3, [51] wait, [48] phase 3 WHAPI, route 2 [46] Brand DNA task with a fixed assignee) and 4.3 (8925654: [11] handoff comment, [20] status IN PROGRESS, [17][18] Tech task `t-86ex8x9xw` in `901816723190`, [21] card fields incl. status `dbd21650`, [22][23] Creative task `t-86eyu1w3d` in `901818016338`, [26][27] map phase 4, [24] Client Data, [28] wait, [25] phase 4 WHAPI; no Slack module; no dedupe on a second submit).
- **q** Request types: 34 (index 0 to 33, `client_low_score` 33); targets carry `list_id`, `template_id`, `owner_rule`; no onboarding or Brand DNA type.
- **r** Storage buckets: no `cockpit-form-files`; `cockpit-upsell-files` (private, 10 MB, images) exists as the pattern.
- **s** Code anchors at `b4db4eb8`: Four Rs links in `csmLinks.ts` (client success `:220-241`, media buyer `:146-167`), `csmMoney.ts:131,162,170,178` (both apps), `ClientAsks.tsx:35`, `csm_assistant.py:42-43`; media buyer `csmTemplates.ts:34` still links `BbJy6xg4`; `growth.js:848` `KICKOFF_FORM = "tG7dnxBn"` and `:856` the filter; `20261024a_brand_blueprints.sql:602` reads kickoff refs; portal `src/components/PersonalForm.tsx` embeds `KFRCXPFx`, `src/lib/onboarding.ts:13-14` builds its link, `src/lib/client-form-schema.ts:10` `FIELD_TYPES = ['scale','choice','multi','text','longtext','tick']`.
- **t** pg_cron: `mahara-billing-daily` `10 5 * * *` → `cockpit_billing_daily()`; `mahara-clickup-writeback-forms` every minute; `mahara-form-schedule` `0 7 * * *`; no relay job.
- **u** No `billing_agent` Postgres role exists; `authenticator` and `supabase_read_only_user` do.
- **v** For `20261102m` (2026-11-02, X37): `schema_migrations` holds `20261102a` to `k`; of every local and remote branch only `forms-s4-fixes` holds a `20261102l` or later file (`l`; `m` is untracked in its worktree), and the worktree `goals-sheet` (branch `goals-sheet-1102`) holds an untracked `20261102m_goal_sheet_truth.sql`; `guard_check.py supabase/migrations '20261102m*'`: `n` 6, `live` 5, `odd` `cockpit_form_stage4_build(jsonb)` (live holds `j`'s `a704e72a…`; `l` is not applied); `cockpit_settings` `stage4.templates` and `stage4.messages` are `{}` and there is no `onboarding.raw_titles` row; `cockpit_requests` has no `task_comment` column; 6 option-map rows for `bab9a58b`.

### 11.3 The C9 retire list (seed of `cockpit_retire_items`; state as of 2026-11-02)

Owner roles: the systems manager (Make and Typeform), the CEO (sheets and the old card-data DM).
"Quiet" = no run and no answer through the old link for 14 days. Archive = Make folder "09 Archive" /
Typeform left closed and marked; never delete.

| Item | Used for | Replacement | State now | Switch-off step | Archive from |
|---|---|---|---|---|---|
| Make `9805665`, `9000763`, `8069181`, `9585358` | extension, Confirm Charge | billing sheet Extend, Confirm paid (W12 C1) | off since 2026-11-01 | done (W12 D-C1) | 2026-11-16 if quiet |
| Make `9805613` | pause on the client's submit | pause sheet + pause consent (W12 C2, W34) | off since 2026-11-01 | done | 2026-11-16 if quiet |
| Make `9805538` | termination on submit | exit survey + churn confirm (W34 C4b) | off since 2026-11-02 | done | 2026-11-17 if quiet |
| Make `9209179`, `9523861` | 1-1 notes, recap sender | 2b cut-over | off since 2026-11-01 | done | 2026-11-16 if quiet |
| Make `8962418` | old cancellation to sheet (invalid) | exit survey | off (invalid) | none | ready (quiet for months) |
| Make `9169732` | closed to RAW LEADS | none needed (webhook `WHTP4096881` disabled 11-02) | off | none | 2026-11-16 if quiet |
| Make `9783436` | draft internal request | `/requests` | off | none | ready |
| Make `8063994`, `8064859`, `8065434` | Monday-era ticketing, QA | `/requests` | off | none | ready |
| Make `8962328`, `8962387` | NPS, CSAT to Slack | native NPS/CSAT (W34 C5) | on | W34 D-C5 (waits on Q4) | 14 days after D-C5 |
| Make `8068892` | OLD NPS and CSAT to Slack + Sheet (0 runs) | native NPS/CSAT | on | D-C9 | 14 days after |
| Make `9169735`, `9188441`, `9190294`, `9195843`, `9205789` | Four Rs to sheet, comment, Slack | Log a win (C7) | on | D-W | 14 days after |
| Make `9122691` | lead list | request type `whatsapp_reactivation` | on | D-C9 | 14 days after |
| Make `9282377` | website sell form | request type `landing_page` | on | D-C9 | 14 days after |
| Make `9018535` | client card info to sheet + DM | none (card data is not collected; retired 10-26) | on | D-C9 | 14 days after |
| Make `7908153`, `8069605` | OLD Monday kickoff and card info (map card number and CVV) | none | on, 0 runs | D-C9 (first in the window) | 14 days after |
| Make `8925654` | kickoff effects | native kickoff (Stage 4) | on | D-S4K | 14 days after |
| Make `8922994` | onboarding effects | native onboarding (Stage 4) | on | D-S4O | 14 days after |
| Make `9748311` | Blueprint (Make 14) | cockpit Blueprint (A1) | on | after the first real native Blueprint close (plan 5.20) | 14 days after |
| Make `8979157` | New Client Form MAIN | stays (D14); module [45]'s Kickoff Form Link swapped to the cockpit link at D-S4K; [40] keeps the `KFRCXPFx` link (X26) | on | kept | never |
| Make `9686154`, `9356423`, `9744107`, `9742600`, `8866601`, `8903351`, `9799073`, `9808298` | resume reminder, first launch date, status forward, contracts, payment failure, client update, WhatsApp reconnect, market intel verified | stay (not form scenarios, or still the writer of record) | on | kept | never |
| Typeform `gqBcyK6g`, `CTUjv6l3`, `knIe4eF3`, `fRokTITH` | extension, pause, termination, 1-1 notes | native | closed | done | 14 days after close if no legacy answer |
| Typeform `fuPgs85S`, `KbcbPA73` | NPS, CSAT | native | open | W34 D-C5 | 14 days after |
| Typeform `ETEynRgb`, `bAmbMKM2`, `cKItPZVI`, `VP3zmaj2`, `IVHO9BMC` | Four Rs | Log a win | open | D-W | 14 days after |
| Typeform `uXtImBuZ`, `PjfTJypg` | lead list, site design | request types | open | D-C9 | 14 days after |
| Typeform `Aa6nUPOs`, `uUEp9YwJ`, `BbJy6xg4`, `Uju17Z13`, `ecJQ5Z5C` | old onboarding (2), old kickoff, card info, reactivate ads | native onboarding, native kickoff, none, none | open | D-C9 | 14 days after |
| Typeform `oYZKtogO` | old Blueprint | cockpit Blueprint (A1) | open | after the first real native Blueprint close | 14 days after |
| Typeform `tG7dnxBn` | kickoff | native kickoff (Stage 4) | open | D-S4K | 14 days after |
| Typeform `KFRCXPFx` | onboarding | native onboarding; after D-S4O its deliveries feed the native planner (X26) | open | after [40] carries the native invite (section 10) | 14 days after close |
| Typeform `BTzMwXiw` | New Client Form | stays (D14) | open | kept | never |
| Webhook `WHTP4364124` on `o0ULXQhD` | sandbox ticket form to inactive 9783436 | none | on | D-C9 | — |
| Webhooks `WHTP4007419`, `WHTP4007430` | NPS, CSAT | native | on | W34 D-C5 | — |
| Webhooks `WHTP4149695`, `WHTP4077499`, `WHTP4030451` | site design, lead list, card info | request types / none | on | D-C9 | — |
| Webhooks `WHTP3992232`, `postcallsummary` (on `tG7dnxBn`), `WHTP3991048` (Make's hook on `KFRCXPFx`) | kickoff, onboarding | native (the forms-door webhook on `KFRCXPFx` stays) | on | D-S4K, D-S4O | — |
| Sheet tab "04: Referrals, Upsells, Reviews"; the sheet and DM holding card data (`Uju17Z13`) | Four Rs log; card data | wins ledger; none | live | D-W (freeze); the CEO clears card data (plan 5.20) | — |
| Sheet tab "Payments" (owner: the CEO) | the billing agent's old payments log (C8) | the billing inbox and the checks list | live | D-AG (freeze: range protected, read back) | — |

HighLevel's own client forms (0 submissions), the Free Gift Survey, Team Onboarding, the old opt-in
form and the three empty drafts are out of scope (plan 5.20) and are not seeded.

### 11.4 Review notes for the orchestrator

- Read 2.2 against live again right before builders start (the two tie RPCs added in revision 1 included); W34's pre-deploy review changed bodies after its contract was written.
- Revision 1 (2026-11-02) applied the contract review's findings; what was declined or applied in another form is listed in 11.5.
- `ClientForms.tsx` is owned by cockpit-screens (7); no other slice edits it.
- Stage 4 is the largest piece; a `differs` (D-S4.0 found three, the rebuilt parity's first run more, 11.8) is fixed on a branch and the parity run repeated (D-S4F), never answered by switching off Make on a partial parity. Since X37 a text difference is fixed, never recorded as intended without the CEO's word (11.9).

### 11.5 Contract review, revision 1 (2026-11-02): declined, or applied in another form

Every finding was checked against the repo, live (SELECT only) and memory before it was applied.
These were declined, or applied differently from the fix the review suggested:

| Finding | What was done | Why |
|---|---|---|
| Tie candidates should leave out every active `cockpit_deal_payments` row, remainders included | Declined in that form; X33: only a deal's own contract money is left out; a rule-2 remainder is a candidate with "counts for the closer now", a required CEO reason, and the approved-month refusal (X31) | Leaving out every remainder would make Q23's day-30 upsell (a rule-2 card match) impossible to tie, which a second finding raised; the reason plus X31 stop closer money moving silently or being paid twice. |
| `ceo-actions.test.ts` breaks when the apply is retired | Assigned to money-rails to run unchanged, not to edit | It tests the SQL `ltv.preview`, which this contract does not replace; the apply is refused only in the Edge function. |
| Move the next payment date automatically when a receipt is checked | Applied as a Today band that opens Confirm paid (X29) | A trigger on the live W12 check RPC could write a second date for one save; Confirm paid is the one date-moving act. |
| Send the onboarding invite automatically at card creation as a WhatsApp `form_invite` | Not chosen; X26 keeps [40] on the Typeform, whose deliveries now feed the native planner | WhatsApp form invites are off (CSM approval, 2b rule) and the group is created by the same Make run; keeping [40] needs no new send path and no imitated submission. |
| Phase 3 and phase 4 proven end to end, or Make's WhatsApp module kept on alone | The internal WhatsApp group for the test card is made a people prerequisite of Stage 4 (1.3, D-S4.0) | A partly-on Make scenario is a second writer to retire later; a team-only group proves the real send path. |
| Convert HEIC receipts to JPEG on upload | Declined; Checks waiting shows `Download to view` for HEIC | Conversion in the browser adds a library and a second stored file; the original stays the evidence. |
| Reactivate with no confirmed departure: allow it or refuse | Refused with the next step (X30) | The departure is what keeps the month they left counted. |
| A scheduled bank receipt trigger (E20) | Applied as a Today band (X28) | A scheduled request would reach card payers. |
| Full bilingual question table for the native onboarding in 5.9 | Not written here; the go-live waits on the CEO's look at the drafts in the forms editor (1.3, D-S4O) | The 33 questions' wording comes from the stored Typeform titles at build time; writing the other language here without the definition would guess. |
| AG: give the agent its own env file and move other workers away | Applied only where possible (4.5, D-AG0); otherwise "not achieved" is stated (X27) | A separate Unix user may not exist on the VPS; the contract cannot promise a separation it cannot verify from here. |


### 11.6 Implementation review, revision 2 (2026-11-02): what changed

Each finding of the post-integration review was checked against the code, the live database (SELECT only)
and memory first. Applied (the migrations are not live, so g to j were edited in place; drift-guard
"after" md5s were recomputed for the bodies that changed):

| Area | Change |
|---|---|
| 4.9 pay proposals | A win is read in every month its money falls in: a referred deal's first payment or a tied upsell payment before the win day is proposed once, in its own month (`cockpit_win_first_day` starts the WinRow series there). Decisions store the `cash_usd`/`quantity` they covered; cash tied or checked after a decision is proposed as a top-up key `win:{id}:{part}:{YYYY-MM}:{n}` (the decide tells the entry save, transaction-local, that this key is a new decision; a typed third entry is still refused). A tied payment the closer was already paid on in an approved month reads `waiting`: `This payment was paid to the closer in {month}.` Renewals and reactivations clear on the agreement only (`Add the agreement link to clear it for pay.`), as 3.3 says. |
| 3.2 void | A CSM cannot void a win with a confirmed pay decision (`This win was paid for. Ask the CEO to void it.`); the CEO's void lists the open-month entries it made. A proof link paid for on a voided win is refused at log. |
| 4.3.6 / 4.12 | Reactivate attaches a reactivation the CSM logged by hand within 60 days (departure set through the act; the guard allows only that move) instead of logging a second win. |
| 5.1 referral picker | The CEO sees every signed deal of 120 days; a CSM only deals whose lead source says referral or whose card the CSM is allowed on (`cockpit_win_referral_deals`), at read and at log. |
| 4.6 | Server-side days (4.6.6). |
| 4.4.2 | The LTV step runs inside its own exception block: an error writes `billing-ltv` ok=false and `LTV: not written (error).` and the run commits. |
| 4.4.3 C8 | Convex `ceo.ltv.apply` and `setStartingFigures` refuse first; `portal_billing_ltv_prepare` now always answers `hold` and `_finish` refuses (live md5s guarded, ACL kept so an old portal build stops quietly). D-LTV's pre-check also greps `convex/ceo/ltv.ts` for `field/${CFB.ltv}` behind the refusal. |
| 3.4 agent door | An unknown key writes no health receipt, is answered from memory for a minute, and above 20 unknown keys a minute per instance new keys get 429 before the database; the body is read with a hard 32 KB cap. The Python client refuses redirects (the key is never re-sent to a Location host). |
| 4.10.3 / 4.10.6 / 4.12.5 | `cockpit_csm_wins_today` (replaced in `i`) adds `receipt_in`, `receipt_checked` (with the rule's date), `back` and `due_no_money` (a transfer payer whose card date passed in 30 days with no payment since a week before, no open receipt invite, not paused or stopped; currency from the last transfer, an amount only in dollars). The receipt hook re-reads a named transfer and attaches only to a live one without a receipt; one receipt per logged payment (unique index). The receipt context's amount and currency are optional; Pending payments sends neither (a plan's parts are dollars, the client's billing currency is not on record). |
| 3.6 slots and files | `portal_form_file_slot` takes `p_access_role` and refuses `admin_only`; the portal route forwards it. The staff file read signs only a slot that very response used on its own card. |
| 4.14 / X26 | The Typeform door runs the planner only for a card onboarding now (in onboarding, pipeline group, or signed up / signed a deal in 30 days); any other card's answer is stored legacy (`why 'not_onboarding'`). |
| 4.14 / 5.9 onboarding v2 | The schema gained `context: []` and `required: false` on its three headings: without them the portal's parser refused the whole form (found by pointing the portal preview at the real schema, a JSON copy at `src/lib/forms/onboarding-v2.json` in the portal, checked equal by shape in both test suites). Minutes 25 (the minutes cap is 1 to 60 in the SQL check, the editor, the portal parser, the pop-up and the asks; Arabic 11+ reads `دقيقة`). Arabic in the plural throughout (`منو`), no `(optional)` in a label, the drive link's checklist became a hint. |
| 11.3 C9 | The registry's replacement and note words carry no build codes; Settings renders the note as the next step in the kit's SectionCard. `postcallsummary`: its only reader is Make 06 (9209179); the CEO turned it off on 2026-10-26 (A3) after 0 of 8 recaps reached a client, so removing it at D-S4K drops nothing (recorded in the row's note). |
| Screens | No label says "(optional)" (FormSheet adds it); sheet titles `Log a win` and `Client is back` with the client underneath; the ribbon runs down a rule under 30rem, links underlined at rest, voided money struck; LTV source line and plurals; the agent card says `Revoked on {date}: {reason}.`; Money tab band in plain words; the portal tile isolates a Latin file name in Arabic; `قاعد ينرفع…`; the Getting started card stops asking once sent and uses a plain file icon until then. A harness (`?w56=on|off|empty|held|revoked|split`, `src/dev/w56Harness.ts`) feeds the four CEO screens. |

Not applied: none of the findings were rejected outright. Not done in this revision: the 375/1280
light/dark screenshots and the Hallmark slop test of the CEO screens (the harness now makes them possible;
they wait on a browser session), and the CEO's read of the Arabic drafts under aziz-kuwaiti-voice (1.3).

### 11.7 Pre-deploy review 2026-11-02

An independent review of the whole branch (cockpits and portal) before the deploy confirmed 10 findings
and listed 5 lows; each was reproduced in a PGlite or bun test first (red) and then answered. The
migrations are still not live, so g to j are edited in place and still apply twice; drift-guard "after"
md5s are recomputed for every guarded body that changed.

| # | Finding | How it is answered |
|---|---|---|
| C1 (high, `h`) | A referral is paid twice when the referred deal's first payment day moves to another month | Flat parts (referral, review, testimonial, podcast, renewal, reactivation) pay once per win: once any month of `win:{id}:{part}:%` is decided, `cockpit_win_pay_rows` reads the win in that month only, and `cockpit_win_first_day` never starts after it. The C7 entry rule refuses a second live entry with the same win reference and a flat part whatever its month ("This win is already paid for {month}."). `wins-pay-supabase.test.ts`, "a referral pays once when the first payment moves". |
| C2 (high, `h`) | The closer-paid guard stops working once the money refresh drops the win-tied payment from the deal ledger | The tie confirm records the payment's ledger membership on `cockpit_win_tie_proposals` (`ledger_deal_response_id`, `ledger_day`, `ledger_closer_id`, `ledger_setter_id`). `cockpit_win_closer_paid` first reads approved months whose frozen `commission[].payments` list the payment, then the live ledger row or, once it is gone, the recorded membership. |
| C3 (medium, `h`) | A paid referral or renewal the CEO voids can be logged again and paid again | `cockpit_win_paid_twin` matches a void win that still has a live pay entry by the same proof link, referred deal, agreement link (renewal, reactivation) or return (departure, or a Reactivate within 60 days). Log a win refuses it; a later-cleared win waits with "Already paid on the win of {day} that was voided since"; the C7 rule refuses its entry. Removing the old entry (an open month only) lets it be paid again. |
| C4 (medium, `h`) | Recurring upsell: tying an earlier month later pays the 20% first-month rate twice | The engagement's start month is fixed by the first live confirmed recurring entry (its month less its engagement month). A payment from before it waits: "Paid before {month}, the engagement's first paid month, whose first-month rate is already paid. Add it by hand with a reason if more is owed." |
| C5 (medium, `h`) | The closer-paid guard ignores the setter's commission on the same deal cash | `cockpit_win_deal_people` resolves the deal's closer and setter as `cockpit_pay_facts_sales` keys them (`personId`), else by folded roster name with one hit; the guard reads paid when either person's approved month covers the payment, and the refusal names "the closer" or "the setter". |
| C6 (medium, `j`) | A forged Typeform onboarding answer locks out the real client and runs the native planner on attacker data | A row `cockpit_form_onboarding_typeform` stored from the hidden card id only (`owner` cockpit, `match` `hidden_id_unverified`), and the read-model entry of the same token, no longer count in `cockpit_form_stage4_answered_at` (so `portal_form_onboarding_open` and the planner's once-per-card check) or `cockpit_form_card_allows`; a `confirmed_by_person` row and Make-era rows still count. A later real answer is planned as the first. Open: the forged answer still runs the planner once, and no CSM confirm path exists for an unverified Typeform answer. |
| C7 (medium, `billing-agent`) | A revoked (leaked) key is never throttled: every call writes database rows and a health receipt | The door treats a revoked 401 like an unknown key: no receipt, no pass as a key seen working, refused from memory for a minute (3.4; `door.test.ts`, "a revoked key is refused like an unknown one"). In `g`, `cockpit_agent_door_open` writes a revoked key's `refused` row at most once a minute (counting the per-key rate first would still write a `limited` row per call). |
| C8 (high, `g`) | The receipts door probes the old file-slot signature, so it can never open | The probe names the current signature, `portal_form_file_slot(text,text,text,text,uuid,text,text,bigint,text)`; `cockpit_form_doors()`'s after-md5 is recomputed and a test applies g to j with `bank_receipt` live and reads `receipts` true. |
| C9 (high, `g`) | The new stale rule refuses Confirm paid for parts an audited extension or date event moved more than 21 days later, or earlier | The date rule never aborts the confirm: a mismatch is a "Next payment date stays …" non-move, and a day moved by an unvoided extension or date event on the card is accepted as the screen shows it. |
| C10 (medium, guardian) | An LTV writer error is silent: the run writes `billing-daily` ok=true and nothing reads `billing-ltv` | `ltv-daily` also reads `billing-ltv` while `billing.ltv.on` and fails, quoting its note, when the row is `ok=false`, missing or older than 26 h, with a 26-hour grace after the writer is turned on (6.2 table; `tests/test_wins_cash.py`). |
| L1 (`g`) | The ltv write carries no `old`, so any card edit after the 05:10 event makes the writer skip it as stale | The ltv step passes the card's value as `old`, so only a change to the LTV field itself blocks the write. |
| L2 (`h`) | After a tie clear and re-tie, a voided pay entry still counts as paid | The decided sum counts a decline, or a confirm whose entry is still live; a confirmed row whose entry was removed reads "Its pay entry was removed." and its cash is proposed again as a top-up. |
| L3 (`g`) | Repeating a requestId skips the 60-calls-a-minute limit | `cockpit_agent_door_open` counts calls, repeats included, before the repeat lookup, so a repeat over 60 in the minute is answered 429. |
| L4 (`billing-agent`) | A flood of random keys makes the door answer 429 to the real agent on an instance that has not seen its key work | Over the minute's budget the door checks an unseen key against the key list (read at most once a minute) instead of shedding it: the real key goes on, a revoked one is refused, random keys stay 429; answers from memory no longer spend the budget (3.4; `door.test.ts`, "a flood of random keys never locks out the real agent"). |
| L5 (`i`, portal) | The minutes cap rises to 60 while the live portal (v1.6.0) still refuses any invite over 10 minutes | `cockpit_form_invite_issue_core` refuses a form other than onboarding over 10 minutes, canary included, until `bank_receipt` or `onboarding` is live for clients (both go-lives come after D-P1): "Publish it with 10 minutes or less." Onboarding is never held. |

### 11.8 D-S4.0, 2026-11-02: what it found and what is still open

D-S4.0 read the saved blueprints and definitions (read only; nothing changed in Make or Typeform) and
stopped on three differences. Each is answered on branch `forms-s4-fixes` and deploys at D-S4F:

| Finding | Answer |
|---|---|
| Make 13 [31] is `google-sheets:filterRows`, a search of Client Data column C, and no scenario writes a Client Data row (Make `8979157` only reads columns C and R and sets R on a row already there); the native onboarding planned `client_data_row`, which appended a row | X34: `20261102l` (2.8); the relay keeps only `github_dispatch` and drops its Client Data path and Google key |
| Make 13 [48] and Make 12 [25] end with the client's content folder link (Client Data column H, Google Drive Link); `cockpit_form_stage4_message` fills only `{client}` and `{map_link}` | X35: the templates keep `{content_folder}`; `hermes/client-messages` reads the link by header name from the card's one Client Data row, fills it in the one send, masks it back in every group search, and refuses a missing or non-link cell; the Messages card shows the placeholder as the Client Data link; no SQL change |
| `make_parity.py` cannot read Make: the API has no module bundles, so every run printed `trigger differs`, and it took module 1 as Make 13's trigger (it is 24) | X36: rebuilt on stored answers, an evaluator of the saved blueprints and ClickUp comment fidelity (4.15.1) |

The rebuilt parity's first run (2026-11-02, read only, before D-S4F: 7 kickoffs, 5 onboardings) proved the
evaluator, fidelity `equal` on all 12 runs, and gave `FAIL` for both forms. Expected until D-S4F:
`client_data_row` differs on 5 runs until `20261102l` is applied, and `phase3_whatsapp` and
`phase4_whatsapp` read `setting missing` until `stage4.messages` is filled. Setup still to do at D-S4F:
`onboarding_tasks` (7 runs) and `brand_dna_task` (5) differ because the `client_onboarding` and `brand_dna`
request types are not added yet, and `github_dispatch` because the relay's `config.env` is empty. These are
real differences between the cockpit and Make, still open; each needs a fix on a branch, or an intended
entry in 11.1 with its reason, before D-S4F's run can pass:

| Effect | What differs | What it needs |
|---|---|---|
| `handoff_comment` (7 of 7) | `stage4.templates.handoff` is empty, so the cockpit posts its own text; and no template can match Make: Make writes `Not provided` for every empty value (`ifempty`), the render leaves it blank, and lists come out in the form's order | a builder change in the SQL |
| `raw_answers_comment` (5 of 5) | Make writes a bold heading per answered question with the saved form's full title, the value under it, a blank line between, and a 0 number as blank; `{{answers}}` uses the shorter stored titles and another layout | a builder change in the SQL |
| `profile_fields`, field `7755485f` (5 of 5) | `stage4.templates.profile` is empty; a template of Make 13 [29]'s text with `{{answer:<ref>}}` matches except a revenue of 0 (Make leaves it blank, the cockpit writes 0) | the template, plus the 0 case in the builder or an intended entry |
| `card_fields`, field `bab9a58b` Service Advertised (3 of 7) | Typeform hands Make a multi choice in the order it was ticked, and Make writes the first ticked (`switch(first(…))`); `cockpit_form_stage4_typeform_answers` puts a kickoff list in the form's option order, so the cockpit writes another option. The SQL comment "switch() never matches a list" is out of date | keep the delivered order in SQL, or an intended entry |
| `github_dispatch` | with the blueprint's settings filled in memory, 4 of 5 runs differ on the client name: Make sends the typed Business Name answer (`514bfd3f`), the cockpit the card's name | the payload's name source in the builder, or an intended entry |
| `map_phase3` and `phase3_whatsapp` (not in the run) | Make 13 [31] is a search with no limit that gates [49] to [48]: they run once for each Client Data row it finds, so Make moves the map and sends the phase 3 text not at all for a card with no row, and twice for a card with two. The cockpit moves the map once either way, and client-messages sends the text only for a card with exactly one row. The evaluator always returns one row for [31], so the parity run cannot show it | an intended entry in 11.1, or zero and several rows modelled in `make_parity.py` |

The CEO answered this table on 2026-11-02: "Yes, match Make" (X37). The first five rows are answered by
`20261102m` (2.9) and the comment on each onboarding task; the last row is still open (11.9). The table is
kept as found.

Two more things blocked the canaries, not the parity run. Both are fixed on the branch (11.9) and deploy at
D-S4F (5):

- The Messages card approves a phase draft through `cockpit-forms-api` `recap.approve` (`approveRecap` in
  `supabase/functions/cockpit-forms-api/messages.ts`), which requires Make's booking block at the end of the
  text, so a phase 3 or phase 4 draft cannot be approved today, with or without `{content_folder}`. Fix it on
  its own branch with an Edge deploy: check `phase3` and `phase4` with the text rule and the 1,500-character
  limit, as `approveInvite` does for form links. D-S4K and D-S4O wait on it.
- The Messages card's edit counter shows `/ 4,096` for every kind, while the database caps phase texts at
  1,500 characters (minor).

### 11.9 Match Make (X37), 2026-11-02: what changed, what is open, what cannot match

The CEO's words, on the differences of 11.8: "Yes, match Make". For the same answers the native outputs equal
what Make 12 (`8925654`) and Make 13 (`8922994`) produce, byte for byte where Make writes text. The reference
is `make_parity.py`'s evaluator (X36), proven against the comments ClickUp holds on 12 of 12 real cards. What
it established about Make's inputs, and the SQL now follows:

- Typeform hands Make a multi choice as a list in the order the person ticked it; `encodeURL()` joins a list
  with `,` (no space), `join(…; ", ")` with `, `.
- A number answer of 0 reaches Make empty: `Not provided` through `ifempty`, blank anywhere else.
- Make 13 [41]'s `definition.fields` holds only the answered questions, in the form's order, under the saved
  `KFRCXPFx` definition's full titles.
- The kickoff's hidden values are Make 13 [29]'s Kickoff Form Link evaluated on the card's onboarding answers
  (from 2026-10-22, the cockpit's own kickoff link); `ifempty` applies to every hidden value in the handoff.

**What changed on the branch** (`20261102m`, 2.9; `cockpit-forms-api`; the client-success cockpit):

| Effect | Before (`l`) | Now |
|---|---|---|
| `handoff_comment` (Make 12 [11]) | `stage4.templates.handoff` (empty live), else the cockpit's own `KICKOFF HANDOFF for …` text; a template could not write `Not provided` and listed choices in the form's order | Make's 110 lines in SQL: `Not provided` for an empty hidden value or answer, `Yes`/`No` by `switch`, Payment Amount 0 `Not provided`, lists as ticked |
| kickoff hidden values (Make 13 [29]'s link) | trimmed answers, the appointment types joined with `, ` in the form's option order, a revenue of 0 as `0`, the business name falling back to the card's name | the link's values: as stored, `,` in the order ticked, 0 empty, no fallback |
| `card_fields` `bab9a58b` Service Advertised (Make 12 [21]) | the first listed option the map knows, the list in the form's option order | the option ticked first, nothing when that one is not an option |
| `onboarding_tasks` (Make 12 [17][18], [22][23]) | `left(handoff, 4000)` as each task's description | the whole handoff as `comment_text`, kept on `task_comment` and each part's `taskComment`, to be posted as one comment on each task; until the writer posts it, `l`'s description stays as a stopgap (open, below) |
| `raw_answers_comment` (Make 13 [47]) | `Raw Onboarding Form Answers` and `title: value` lines with the shorter stored titles; a 0 as `0` | `**Raw Onboarding Form Answers**`, then `**<full title>**`, the answer and a blank line per answered question in `KFRCXPFx`'s order; 0 blank; titles from `onboarding.raw_titles`, the effect missing with a sentence while they are not set up |
| `profile_fields` `7755485f` (Make 13 [29]) | `Revenue last year: …` from the template or the cockpit's text, cut at 5,000 characters | Make's seven labels, each kept when empty, 0 blank; still cut at 5,000 characters until the writer takes longer text (open, below) |
| `github_dispatch` client name (Make 13 [25]) | the card's name (billing account, then the response's) | the typed Business Name (`514bfd3f`) as typed, or an empty text |
| `brand_dna_task` (Make 13 [46]) | the raw answers text as the request's details | no details |
| `read_model` | a native list in the form's option order | in the order ticked, as a Typeform answer is |
| kickoff questions | 41; Post call form filled was free text | 46 with `tG7dnxBn`'s five follow-ups; Post call form filled is Yes or No |
| Messages card | `recap.approve` demanded Make's booking block, so no phase draft could be approved; the counter read `/ 4,096` | a phase text is checked as `cockpit_client_message_approve` checks it (not empty, 1,500 characters at most counted as characters, the client text rule), with no placeholder but `{content_folder}` and that one once at most; approved with its exact bytes' sha256 and no warnings; the counter reads `/ 1,500` and turns red past it |
| the kickoff sheet | its own keys (26 differed from the database's list), three questions missing, every list joined into one text; a refused send still showed `Sent.` with nothing stored | the database's 46 questions with their keys, refs, options and limits; `tG7dnxBn`'s required flags and logic; lists in the order ticked; a refused send stores nothing and says what to fix in each answer (5.13) |

`{content_folder}` is allowed once at most, and taking it out is allowed (the message then goes without the
link, as round 1's Messages card says). If the CEO wants it exactly once, one comparison in `phaseRefusal`
(`messages.ts`) changes.

**No longer intended.** Each described what the cockpit did differently; none was a decision:

- The handoff and the other texts compared with whitespace folded (4.13.3, 4.15.1): texts are now equal only
  byte for byte.
- Service Advertised as "switch() never matches a list" (the comment in `j`'s and `l`'s builder) and
  `make_parity.py`'s `service` line ("Make's switch() finds no option for the first listed service; the
  cockpit writes the first listed service it knows"): Make 12 [21] uses `switch(first(…))`. A service
  difference is a `differs` now; the script's line is removed.
- "The handoff text as the task description" for the onboarding tasks (4.13.3 misread Make: [17] and [22]
  write no description; [18] and [23] post the handoff as a comment).
- The card's name in the dispatch, and the raw answers text on the Brand DNA task.
- The 5,000-character cut of the Client Profile and the handoff in the onboarding tasks' description: both
  stay on the branch only as stopgaps until the writer changes below, and each goes in the same change.

These stay intended, because they come from decisions: the Blueprint link (PV), the kickoff link (X15), the
phase drafts waiting for the CSM's approval (X18), one task each per card, the kickoff notice, New MRR (Q21),
the recap staying off (Q22) and the read model (the cockpit's own record).

**The oracle runs** (4.15.5, 2026-11-02, on 7 kickoffs and 5 onboarding answers). Without `m`: the five
differences of 11.8 and the onboarding tasks (7 of 7). With `m`: onboarding `PASS`, 5 runs, the dispatch, the
Client Profile and the raw comment equal byte for byte; kickoff, every effect equal or intended on 7 of 7 with
hidden values from Make 13 [29]'s link and through `cockpit_form_stage4_hidden`, except `onboarding_tasks
differs: nothing posts comment_text on the two tasks; the cockpit writes a task description Make does not`
(below; `FAIL`, 7 runs, 7 differences, in both passes). The plan's `comment_text` equals [18] and [23] on 7 of 7
(3,769 to 4,656 characters), `cockpit_form_stage4_hidden` equals Make 13 [29]'s link on 7 of 7, and
`onboarding_tasks_runner` is equal.

**Open on the branch** (each must be done before the merge, D-S4F; the kickoff sheet's five follow-ups and
`make_parity.py`'s `service` line, open in an earlier draft of this section, are done):

| What | Where | What it needs |
|---|---|---|
| Nothing posts the onboarding tasks' comment | `supabase/functions/clickup-writeback/requests.ts`: `REQUEST_STEPS` is `create, description, owner_due_priority, checklist, tag, fields, request_type, card_comment, replaces`; no file reads `taskComment` | a step after `create` that posts `taskComment` once on the part's created task and finds it again by the part's marker, as `card_comment` does, with its tests. In the same change: `20261102m` drops `details` from the `onboarding_tasks` plan (its stopgap: `l`'s first 4,000 characters of the handoff as each task's description, so the planner's `delivered` stays as true as under `l`), with the builder's after md5 and `stage4-match-make-supabase.test.ts` updated, and `make_parity.py`'s `TASK_COMMENT_STEP` names the step (`test_make_parity.py` fails until it does). The writer fixes a part's steps before its first write, so a request made before the step ships never gets the comment. The kickoff fails the parity run until all three land |
| A text field over 5,000 characters is refused | `supabase/functions/clickup-writeback/forms.ts`, Stage 4 fields step (`f.value.length > 5000`, counted in UTF-16 units) | lift the cap for text fields, and in the same change drop `20261102m`'s `left(v_profile, 5000)` (kept from `l` so a long profile does not fail the whole `profile_fields` row, the Kickoff Form Link with it). Until then a profile over 5,000 characters is cut where Make writes it whole, and one with emoji in its first 5,000 characters is still refused (the cut counts characters, the writer UTF-16 units). Real texts are 352 to 1,233 characters. If ClickUp is shown to cap a text field, this moves to the list below |
| A native answer loses its line breaks | `cockpit_form_answers_check` (`20261102i`; `cockpit_form_store_answer` runs it on every portal answer, so on the native onboarding's) folds every run of spaces and line breaks to one space in a `text` and a `longtext` answer; `cockpit_kickoff_answers_check` (`j`) does so in a `text` answer, and `20261102m` types the kickoff's `whatsappAdd` (`071c480f`, `long_text` in `tG7dnxBn`) `text`. `cockpit_form_stage4_fields('onboarding')` also types `address`, `hours`, `landmark` and `appointmentLength` `text` where `KFRCXPFx` has `long_text` | Make writes an answer as Typeform hands it, line breaks kept: 112 of 1,415 stored Typeform onboarding text answers hold one, on 32 of 42 cards (read on the Mac, counts only). So a native answer typed the same way gives a different raw answers comment, Client Profile and kickoff hidden values. A SQL change: keep line breaks in a long text (and type those questions `longtext`), guarded like `m`; then the kickoff sheet drops `whatsappAdd`'s 500 limit and its test exception. Until then this is a difference on every native answer with a line break, which no recorded answer can show |

**Cannot match** (the parity run reads the plan, so it grades none of these except a planned task
description; each says why):

| What | Why |
|---|---|
| The comment ClickUp holds | `forms.ts` `stage4Step` posts `comment_text`, a blank line, and `Cockpit ref F-` with the first 10 hex characters of the response id; Make posts the text alone. The writer finds its own comment by that line after a POST ClickUp did not answer, so it never posts twice (4.13.4). Everything before the line is Make's text byte for byte. The request writer's task comment needs the same kind of line. Dropping it means finding a comment by its full text, a weaker guarantee: the CEO's call (section 10) |
| What the request path adds to the three tasks | Make 12 [17] and [22] set only a name, a list and a template; Make 13 [46] a name, a list and one fixed assignee, with no dates, fields or description. Through requests the cockpit always adds the task name `{client} - {type label}`, a description with the request marker (and the template's text on the onboarding tasks), a due date (`due_days` NOT NULL), a priority, owners by rule on the onboarding tasks, the client tag, the Request Type field and a link comment on the client card per task. Matching means making these tasks with direct ClickUp writes instead of requests: the CEO's call (section 10) |
| The phase 3 map and message per Client Data row | Make 13 [31] is a search with no limit that gates [49] to [48], so Make moves the map and sends the phase 3 text once per row found: never for a card with no row, twice (to each row's group) for a card with two. The planner cannot read Client Data (no Google key in the database), so it moves the map once either way, and client-messages sends only for a card with exactly one row, on purpose. Not changed by `m`; the parity run cannot show it (the evaluator returns one row). An intended entry needs the CEO's word |
| A Business Name holding `"`, `\` or a line break | Make 13 [25] pastes it into its JSON body unescaped, so Make's request is invalid and fails; the relay sends it escaped. Matching would copy the failure |

**Latent, left as they are** (no stored answer has one):

- Numbers: the evaluator (Python) writes an exponent for more than 15 significant digits or under 0.0001,
  and reads digits of any script; the SQL writes the decimal and reads Arabic-Indic and Extended
  Arabic-Indic digits only.
- Recorded Typeform answers through the parity plan: `cockpit_form_stage4_native_answers` (`j`) drops an
  option it cannot map (naming it in `unmapped`, which the run prints as `answers differs`), an answer to a
  question the form no longer has, and a whitespace-only answer, before the builder sees them. A recorded
  kickoff whose first ticked service is not one of the six would plan the next known one where Make writes
  none. The builder alone matches Make, and a native kickoff cannot hold such an option.
- Until D-S4K the cockpit's own Typeform kickoff link (`prefill.ts`) still joins the appointment types with
  `, ` and passes a revenue of 0 as `0`. Make writes those handoffs; the native sheet reads Make 13 [29]'s
  values from SQL.
