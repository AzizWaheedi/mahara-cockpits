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
on the Stage 4 parity differences (11.8): "Yes, match Make" (X37, 11.9). Later the same day, on what
the cockpit could add on top of Make: "You can even improve what's already there with the data that you
have. So you can add more if it gives us better data." (X39, 4.16, 11.10). This contract
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
11. **Stage 4** (`j`): the **kickoff** (`tG7dnxBn`) becomes a native staff form in the CSM cockpit and the **client onboarding** (`KFRCXPFx`) a native client form in the portal renderer; every Make effect of `8925654` and `8922994` is ported and proven equal on recorded inputs and on the test card before its scenario goes off in the same hour; the kickoff carries the **New MRR** question (Q21). The onboarding Typeform stays open as a second door into the same native planner until Make `8979157` [40] can carry a native invite (X26). Since the CEO's "Yes, match Make" (X37), the native outputs equal what Make writes for the same answers, byte for byte where Make writes text (`20261102o`, 2.9); what cannot match is said in 11.9. Since the CEO's later words (X39), Make's output is the **floor**: the better-data additions B1 to B8 (4.16) sit on top of it and never change it. They go only into a slot Make leaves empty (a cockpit brief in the three tasks' descriptions), an effect of their own (`card_facts`: five card fields, only while empty) or a cockpit-only surface (the kickoff notice, the kickoff rail, the CSM brief, the comment digest); Typeform's typed inputs come back on the native onboarding (`20261102o` round 4, `20261102p`, 2.9, 2.10).
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
| Client message kinds `phase3`, `phase4` (their texts end with the client's content folder link, put in at send, X35); the relay worker for the GitHub dispatch (no Client Data write, X34); parity script (rebuilt on stored answers, X36); Make's texts and choices built in SQL, the five kickoff follow-ups, the handoff as a comment on each onboarding task, and phase drafts approvable in `cockpit-forms-api` (X37, `20261102o`) | 5.12, 5.16 | stage4; D-S4.0 and D-S4F fixes on `forms-s4-fixes` | `CLIENT_MESSAGES_KINDS` unchanged; `FORMS_RELAY_APPLY=false`; `onboarding.raw_titles` `{}` until D-S4F |
| Better data on top of Make (X39, 4.16): the cockpit brief in the onboarding tasks' and the Brand DNA task's descriptions, `card_facts` (empty card fields filled), the kickoff notice's open items (`20261102p`); Typeform's typed inputs on the native onboarding, the queue audit keeping a task comment as its length, room for a long Arabic kickoff (`20261102o`, round 4); the kickoff rail's checks and the card's Drive folder; the CSM brief's assumed currency; the whole kickoff comment in the digest; the portal's typed inputs | better-data plan B1 to B8 | round 4 on `forms-s4-fixes` (cockpits) and `forms-s4-portal` (portal) | the planner's additions run only where the Stage 4 planner runs (the test card, then after each go-live); `card_facts` is held with its form's key in `CLICKUP_WRITEBACK_FORMS_KEYS`; the notice line, the rail, the brief's currency and the digest cut are display only and live on their deploys |
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
| `card_facts` (Consultation Types, ADs Platform, Fathom, Onboarding Call Date, Company Website; only while empty, X39) | its form's key in `CLICKUP_WRITEBACK_FORMS_KEYS` **and** the form's version-2 array (`20261102p`) | Edge secrets, database | FORMS_KEYS `checkin`; registry on version 1 | D-S4K (kickoff), D-S4O (onboarding) |
| The Client Profile backfill (`profile_backfill`, 4.17; only while empty, one-off) | `profile_backfill` in `CLICKUP_WRITEBACK_FORMS_KEYS` (its own lane; `onboarding` in the list never opens it) **and** rows only from `cockpit_form_profile_backfill('apply', …)`, which the deploy session runs | Edge secrets, database | lane not listed; no rows | D-PB, then the lane taken out again |

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
| 6 | `supabase/migrations/20261102o_stage4_match_make.sql` | D-S4F fixes (branch `forms-s4-fixes`) | Make 12's and Make 13's texts and choices built in SQL, the five kickoff follow-ups, the handoff carried whole to each onboarding task's comment, `onboarding.raw_titles`, the onboarding's answers and the kickoff's long texts kept as typed, the onboarding's version 2 retyped in place (2.9, X37); since round 4 (X39) also Typeform's typed inputs on that version 2 (numbers, links, E.164 phones), the queue audit keeping a task comment as its length, and 256 KB for a kickoff's answers. First drafted as `20261102m`: the worktree `goals-sheet` then held an untracked `20261102m_goal_sheet_truth.sql` (11.2-v), which reached live and main first (11.2-x), so under the letter rule this file moved to the next free letter, `o` (2026-11-02, 11.10) |
| 7 | `supabase/migrations/20261102p_stage4_better_data.sql` | better data (round 4 on `forms-s4-fixes`, X39) | the cockpit briefs on the three tasks, `card_facts` in both version-2 arrays, the kickoff notice's open items (2.10). It stands on `o` and stops with `Apply 20261102o before 20261102p.` otherwise. First drafted as `20261102n`: live and origin/main hold `20261102m_goal_sheet_truth` and `20261102n_goal_sheet_media_dedupe` (11.2-x, read at the end of round 4), so under the letter rule this branch's `m` and `n` reached live second and were renamed `o` and `p` on the branch before D-S4F (2026-11-02, 11.10) |
| 8 | `supabase/migrations/20261103c_stage4_profile_backfill.sql` | the Client Profile backfill (next-design plan B2, branch `profile-backfill`) | `j`'s gate plus the two keyed branches `(onboarding, profile_backfill)` and `(new_client, sale_facts)`, and `cockpit_form_profile_backfill` (4.17). Stands on `o`; the letter was read free on live, origin/main and every worktree on 2026-11-03 (live holds `20261103a`, `b`, `e`, `i`) |

**The rename (2026-11-02).** The goals-sheet session's `20261102m_goal_sheet_truth` and `20261102n_goal_sheet_media_dedupe` reached live and origin/main first, so under the letter rule this branch's match-Make and better-data files, first drafted as `m` and `n`, became `20261102o_stage4_match_make.sql` and `20261102p_stage4_better_data.sql` (with their messages, audit actors, tests, harness and docs; no function body changed, so every md5 stands), while `l` was free and kept its letter.

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
| `cockpit_form_versions` `kickoff` version 2 (staff marker `{lives:'cockpit', fields:[{key, typeformRef, title}]}`, 4.13) and `onboarding` version 2 (client schema v1, 5.9; its texts retyped in place by `20261102o`, 2.9). Registry rows stay `provider = 'typeform'`, version 1, with their live effects arrays (11.2-d), until `cockpit_form_stage4_go_live` | seed | | the 30 stored kickoff answers and 46 onboarding answers keep version 1 |
| `cockpit_form_stage4_effects(p_form_key text, p_version integer) RETURNS jsonb` | function, `IMMUTABLE` | none | the whole effects array for each form and version as constants: version 1 = the live arrays of 11.2-d byte for byte; version 2 = 4.15.2's arrays; anything else raises. `20261102l` drops `client_data_row` from both onboarding arrays (2.8) |
| `cockpit_form_onboarding_typeform(p_payload jsonb)` | function | service_role (forms-door) | X26: maps a `KFRCXPFx` delivery by `typeformRef` into version-2 answers (the same mapping `cockpit_form_parity_plan` uses), stores the response (`source 'typeform'`, version 2, state `submitted`) and runs `cockpit_form_hook_onboarding`; a card that already has an answer (2.2 card allows rule) is stored `legacy` instead. Since round 4 (`20261102o` item 16) its version-2 number questions are stored as JSON numbers, as the portal stores them |
| `cockpit_form_option_maps` (`form_key text`, `field_id text`, `answer text`, `option_name text NOT NULL`, PK `(form_key, field_id, answer)`) | table | service_role `SELECT` | the nine kickoff dropdowns (4.13), seeded from the stored field map by option name; D-S4.0 compares them with Make 12's `switch()` |
| `cockpit_settings` `forms.stage4` `{"kickoff":false,"onboarding":false}`, `onboarding.map_urls` `{}` (filled at D-S4.0 from the saved blueprints), `stage4.messages` `{}` (phase 3 and phase 4 texts with `{map_link}` and `{content_folder}`, filled at D-S4F, X35) | seed | | the run refuses an empty `map_urls` or `messages` entry with a sentence, never sends a blank |
| `cockpit_client_messages_kind_check` gains `phase3`, `phase4` | CHECK swap | | guarded |
| `cockpit_requests_source_check` gains `form`; `cockpit_requests_check1` becomes `(source IN ('import','form')) OR (requester_member_id IS NOT NULL)`; column `form_response_id uuid REFERENCES cockpit_form_responses(id)` (unique per `(form_response_id, type_key)`) | CHECK swaps, column | | guarded |
| `cockpit_form_relay_outbox` (3.8) | table | service_role `SELECT, INSERT, UPDATE` | unique `dedupe_key`; audit; no delete |
| `cockpit_kickoff_prefill(p_task_id text)`, `cockpit_kickoff_submit(p_task_id text, p_answers jsonb, p_request_id uuid)` | browser RPCs | authenticated | 3.3, 4.13 |
| `cockpit_kickoff_answers_check(p_answers jsonb) RETURNS jsonb` | function, `IMMUTABLE` | none | `{ok, errors}` with the codes of W34 3.1 plus `format`; replaced by `20261102o` so a long text keeps what was typed (2.9) |
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
`20261102o` (2.9) is the later match-Make change, not the content folder.

| Object | Kind | Grant | Notes |
|---|---|---|---|
| `cockpit_form_stage4_effects(text,integer)` | replaced; guard live md5 `afa3e203fa6dda7182d9352b38254c0e` (`j`'s body), after `1b01ccc56e88b8fa4f4fc8985d36c93c` | owner only (ACL kept, revoked again from the four roles) | both onboarding arrays lose `client_data_row`; version 1 drops Make's entry rather than relabelling it, because [31] writes nothing: it is a search that gates [49] to [48] (`map_phase3` and `phase3_whatsapp` run once per row it finds, 11.8), while Make 12's [24] comes after the map edit [26] and gates only `phase4_whatsapp`; the kickoff arrays are unchanged |
| `cockpit_form_stage4_build(jsonb)` | replaced; guard live md5 `a704e72a3921191d2f06a24855d7f219`, after `7e5f7fdaadc74983367cd07bd8c56e3c` | owner only | plans no `client_data_row`; every other effect and the order are `j`'s |
| `cockpit_form_relay_outbox` CHECKs | narrowed | | `effect_key = 'github_dispatch'`, `dedupe_key ~ '^relay:[0-9a-f-]{36}:github_dispatch$'`; each narrowed only from `j`'s exact definition; the file stops while any `client_data_row` row exists (live 2026-11-02: none) |
| onboarding registry row | data | | `j`'s version-1 array becomes the new version 1, `j`'s version-2 array (after a go-live) the new version 2, so `cockpit_form_stage4_go_live`'s drift check still passes; any other array stops the file (`The onboarding effects changed since 20261102j; stop and re-read them.`); one audit row `forms.stage4_no_client_data_row` |

Unchanged, because none names `client_data_row`: the planner, the parity plan, `cockpit_forms_effects_valid`,
`cockpit_form_effect_gate` and the relay's claim, done and counts. PGlite: `stage4-native-supabase.test.ts`
applies `l` after `j` (37 pass; since round 3 it applies `o` after them, 40 pass, 2.9);
`stage4-content-folder-supabase.test.ts` proves both phase templates pass `cockpit_form_stage4_message`
unchanged (5 pass).

### 2.9 `20261102o_stage4_match_make.sql` (D-S4F fix, X37)

Written after the CEO's "Yes, match Make" (X37, 11.9): for the same answers the native kickoff and onboarding
write what Make 12 (`8925654`) and Make 13 (`8922994`) write, byte for byte where Make writes text. The
reference is `scripts/dev/make_parity.py`'s evaluator of the saved blueprints (X36). It stands on `l`: while
the builder is still `j`'s (`a704e72a…`), or a function it reads is missing, it stops with `Apply 20261102l
before 20261102o.` (`55000`). It applies twice and copies `l`'s drift guard: each replaced body must be the
live one (read 2026-11-02; `i`'s for the two client form checks, `j`'s for the kickoff check, `20261026t`'s for
the writeback queue's audit trigger) or this file's own,
and for the builder `l`'s after value, because `l` replaces it first; anything else stops the file with
`<function> changed since 20261102l; stop and re-read it.` (`55000`; for the audit trigger the words say `l`, but its
baseline is `20261026t`'s live body). It also guards the onboarding's version 2 by
`md5(schema::text)`: `j`'s `8fa1f38dfd4307f22d0b3faec8604ce7` (live) or its own `bc89ca36000ebf7943c6ec569cd1be73`
(round 3's was `2b9cd946…`),
else `The onboarding form's version 2 changed since 20261102j; stop and re-read it.`; and while it is still `j`'s,
any response or invite on version 2 stops the file with `The onboarding form's version 2 is in use ({n} answers and
invites), so it cannot change in place: stop, and give its long texts and limits a version 3 instead.` (live
2026-11-02: none, 11.2-w).

Round 3 (2026-11-02) closed 11.9's three open rows: the request writer posts the handoff on each onboarding task
(`clickup-writeback` `requests.ts`, 4.13.4), so the plan carries no details; the forms writer takes a Stage 4 text
of any length, so the Client Profile is never cut; and an answer keeps what was typed, as Typeform keeps it for
Make (rows below, 3.6). **Ship order:** `clickup-writeback` with the `task_comment` step deploys before this file
is applied (D-S4F (2)), because the writer freezes a request part's steps before its first write: a part frozen by
the writer before it never posts its `taskComment`.

Round 4 (2026-11-02, X39, the better-data plan's B3 and two fixes 11.9 left open) adds three pieces to this file and
changes nothing Make's texts print: **Typeform's typed inputs** on the onboarding's version 2 (the three revenues are
numbers, the four links have the url format, the three phones are stored as E.164; rows below and 3.6); **the queue
audit** keeps a request part's `taskComment` as its length (`cockpit_clickup_writeback_audit`); and **a kickoff's
answers get 256 KB** (`cockpit_form_responses_answers_check`), with a refusal by name past it. `cockpit_form_stage4_build`
is untouched (after md5 `a565db2d…`), so `20261102p` stands on it.

| Object | Kind | Grant | Notes |
|---|---|---|---|
| `cockpit_form_typeform_text(text)` | new, `IMMUTABLE` (md5 `4509bcd520194d07a477d24dd183df91`, not guarded) | owner only | an answer as Typeform keeps what was typed and hands it to Make: a carriage return, alone or before a line feed, is one line feed; no white space at either end (the characters JavaScript's `trim()` takes, written as ASCII `\u` escapes so the result does not depend on the database locale); everything between as typed. Read 2026-11-02 (11.2-w): Make 13 [29]'s Kickoff Form Link on 69 cards carries 914 answers as Typeform handed them to Make, 52 with a line feed, 16 with a double space, 26 with a space before a line feed, none with a carriage return and none with white space at either end; the Client Profiles Make wrote on 11 cards agree. The stored answers cannot show the trimming themselves: the cockpit's own ingestion trimmed them |
| `cockpit_form_stage4_make_text(text,text)` | new, `IMMUTABLE` | owner only | an answer as Make writes it in text (the evaluator's `typed()` then `to_text()`): a number question's answer without trailing zeros, 0 as nothing, Arabic-Indic digits read as digits; any other answer as it is |
| `cockpit_form_stage4_handoff_text(jsonb,jsonb)` | new | owner only | Make 12 [11]'s 110 lines as the saved blueprint has them (the same text [18] and [23] post): an empty hidden value or answer is `Not provided` (`ifempty`); each yes/no line is `Yes` for yes or true, `No` for no or false (case and surrounding space ignored), and `Not provided` for any other answer or none (`switch`); a Payment Amount of 0 is `Not provided`; a list keeps the order it was ticked |
| `cockpit_form_stage4_profile_text(jsonb)` | new | owner only | Make 13 [29]'s `7755485f`: `Last Year's Total Revenue`, `90-Day Goal Revenue`, `12-24 Month Revenue Goal`, `Marketing they've tried A-Z`, `Top 3 challenges`, `Why they joined`, `Additional notes`, a blank line between, each label kept when its answer is empty, a revenue of 0 blank, never cut |
| `cockpit_form_stage4_raw_answers_text(jsonb,jsonb)` | new | owner only | Make 13 [41] to [42] to [47]: `**Raw Onboarding Form Answers**`, a blank line, then each answered question in `KFRCXPFx`'s order as `**<its full title>**`, its answer and a blank line; a revenue of 0 is a blank line; a question answered twice takes its last answer; an answer whose ref has no title keeps its own title and comes after the titled ones, in answer order |
| `cockpit_settings` `onboarding.raw_titles` = `{}` | seed `ON CONFLICT DO NOTHING` | | `{fields:[{ref, title}]}`, an array because jsonb loses key order and the comment needs the form's order (X20); filled at D-S4F from `scripts/dev/forms-deploy/stage4-raw-titles.json`: the 36 questions of the saved `KFRCXPFx` in its order, with its full titles (no person's name) |
| `cockpit_requests.task_comment text` | column, `IF NOT EXISTS` | | the comment each task of a request gets once it is made, whole: the handoff for the two onboarding tasks, NULL for every other request; the audit row holds its length, never its text |
| `cockpit_form_stage4_fields(text)` | replaced; guard live `8c36fd1cf1b0a60b0c776241765eddf7` (`j`'s), after `2b874cb1ed7fcf92a3d7fd9ca00547c5` (round 2's was `032868f5…`) | owner only | kickoff: `j`'s 41 plus `tG7dnxBn`'s five follow-ups that Make 12 [11] prints, each after the question it follows, with `tG7dnxBn`'s titles: `detailsCorrection` (`c0000001-…-0012`), `linksCorrection` (`-0013`), `operationsCorrection` (`-0014`), `profileMissing` (`-0015`), `contractChanges` (`-000b`); `postCallFormFilled` becomes a Yes or No choice, as in `tG7dnxBn`. `cockpit_kickoff_answers_check` reads this list, so it takes the five and refuses any other answer to Post call form filled. A question `tG7dnxBn` or `KFRCXPFx` asks as `long_text` is `longtext`: the kickoff's `whatsappAdd` (`071c480f`) and the onboarding's `address`, `hours`, `landmark` and `appointmentLength`, which `j` made `text`. The onboarding's 36 keys, refs and order are unchanged. The kickoff's version-2 record in `cockpit_form_versions` still lists the 41; the submit never checks against it |
| `cockpit_form_stage4_hidden(text)` | replaced; guard live `cb8d434b635091957a15c7ca96652848` (`j`'s), after `c43644ee277f532770e523e61e389aad` | owner only | what Make 13 [29]'s Kickoff Form Link carries for the card's stored onboarding answer: each answer as stored (never trimmed; the last answer of a question answered twice), the appointment types joined with `,` in the order ticked (`encodeURL` of a list), a revenue as Make's number (0 is nothing); a missing or empty answer is left out, so the handoff says `Not provided`; the business name no longer falls back to the card's name. Read by `cockpit_form_stage4_input` and the kickoff sheet's prefill |
| `cockpit_form_stage4_typeform_answers(text,jsonb)` | replaced; guard live `97ec3ad0bb4d2282c518be1447d4f262` (`j`'s), after `c9ad150b861d72d497ccb6f3af16cf7e` | owner only | a list keeps the order it was ticked, for both forms, each option once where it was first ticked (`j` used the form's option order), so the read model and every text list a native answer as Typeform hands a multi choice to Make |
| `cockpit_form_stage4_build(jsonb)` | replaced; guard `l`'s after `7e5f7fdaadc74983367cd07bd8c56e3c`, after `a565db2d881852ff3a1481a438768e20` (round 2's was `38533746…`) | owner only | `l`'s, with Make's texts and choices: the handoff; `onboarding_tasks` is `{typeKey, comment_text, lines}`: the whole handoff as `comment_text` and no details, so each task's description holds only what the request route writes (round 2's stopgap, the handoff's first 4,000 characters as the description, is gone); Service Advertised is `switch(first(list))`, the option ticked first, and nothing when that one is not an option; the Client Profile whole, never cut, as Make 13 [29] writes it (`l` cut it at 5,000 characters); the raw answers comment, or `missing` with a sentence (nothing posted) while `onboarding.raw_titles` is empty, malformed or has no title for an answered question; the dispatch's `client` is the typed Business Name answer (`514bfd3f`) as typed, or an empty text; the Brand DNA task has no details. `stage4.templates` no longer shapes any text. Every other effect is `l`'s byte for byte |
| `cockpit_request_create_system(text,text,jsonb,uuid)` | replaced; guard live `295e926095e7832e7d7a220b4d233a23` (`j`'s), after `45207dde9903fee3c1d0aa0b20eea18f` | owner only | `j`'s, plus the plan's `comment_text` beside the details: kept whole on `task_comment` and in each part's queue payload, tech and creative, as `taskComment`, never in the description or the answers (the onboarding tasks now get no details, so `answers` is `{}`) |
| `cockpit_form_stage4_plan(uuid,boolean)` | replaced; guard live `cb27a3730e539bcfbb46dea136af96ae` (`j`'s), after `1b13ba4315097727973c4bff54f027c3` | owner only | `j`'s, except that a system request is handed the plan's `comment_text` beside its details, and that a plan over what `cockpit_form_effects_plan_check` keeps no longer stops the planner: that one effect is kept as its `lines` and `planBytes` and, when it was to run, ends `failed` with `This step carries more than the 2 MB the cockpit keeps for one step, so it did not run. Do it by hand from the stored answers.` (a dry-run or skipped effect keeps its own reason); the answer's other effects still run, and neither the onboarding hook nor the kickoff send raises. Only that CHECK is caught; any other error is raised as before. `onboarding_tasks` still reads `delivered` once the request exists |
| `cockpit_form_effects_plan_check` on `cockpit_form_effects` | CHECK replaced (guard: the definition live holds, `20261027f`'s 131,072 bytes, read 2026-11-02, or this file's; anything else stops the file with `cockpit_form_effects_plan_check changed since 20261027f; stop and re-read it.`) | | a `kickoff` or `onboarding` plan holds up to 2,097,152 bytes, every other form 131,072 as before. Under 3.6's limits one onboarding answer reaches about 171,000 characters (two bytes each in Arabic), and the raw answers comment, the read model, the Client Profile and the next kickoff's handoff carry its texts whole; 2 MB is twice the largest answer the cockpit stores (1 MB, `20261102f`), so every native answer's plans fit. Applying it takes a brief lock on `cockpit_form_effects`. On rollback it stays: a plan already over 131,072 bytes would refuse the old CHECK |
| `cockpit_form_schema_check(jsonb)` | replaced; guard live `1f5d9016571ed472b83dbffa17363095` (`i`'s), after `07f88396a8df9e1b2b42f41b5c3e189a` | owner only | `i`'s, except that the client onboarding (`key` `onboarding`) may give a text up to 1,000 characters and a long text up to 10,000; every other form keeps 200 and 2,000 (the test proves it equal to `i`'s body on them) |
| `cockpit_form_answers_check(jsonb,jsonb,jsonb)` | replaced; guard live `d1d8bb66ae056415f8a2a968627220df` (`i`'s), after `ac54af52c93ca8f2517a5f55b507cfa7` (round 3's was `18ea9422…`) | owner only | `i`'s, except that on the client onboarding a text or long text answer is kept through `cockpit_form_typeform_text` and its length counted on what is kept; a value that is only white space the fold does not see (a no-break space) counts as blank. Every other form folds each run of white space to one space, as before (compared answer for answer with `i`'s body). `cockpit_form_store_answer` runs it on every portal answer, so a native onboarding answer reaches the planner as typed. **Round 4 (B3):** on the client onboarding only, a `text` with format `phone` is stored as E.164 after the length check: spaces (tab, line breaks, no-break and the Unicode spaces), zero-width and direction marks (U+200B, U+200E, U+200F, U+202A–U+202E, U+2066–U+2069, U+FEFF), dashes (`-`, U+2010–U+2015, U+2212), dots, `( ) [ ]` and full-width brackets come out, Arabic-Indic and Persian digits read as 0-9, a leading `00` becomes `+`; then it must be `^\+[0-9]{8,15}$`, else `format` (the portal's "Write a phone number with its country code."). Every escape is written as `\uXXXX` text; the file holds no invisible character. Every other form's phone check is `i`'s (the test compares answer for answer). A revenue that is not a JSON number in range gets `range` (a JSON string such as `"1500000"` is refused: the portal sends a number); a link without `http(s)://` gets `format` |
| `cockpit_kickoff_answers_check(jsonb)` | replaced; guard live `8a02898fe501f501b7f7cc8653453db6` (`j`'s), after `8c3045bcdcf0906294d78d9ca7377a9b` (round 3's was `d382c5d9…`) | owner only | `j`'s, except that a long text is kept through `cockpit_form_typeform_text` (`j` trimmed only spaces at its ends and kept a carriage return); a short text still folds, as decided (X37, 11.9). Limits unchanged: 4,000 characters for a long text, 500 for any other. **Round 4:** answers that pass every other check but are over 262,144 bytes as stored give `{ok:false, errors:{_answers:'too_large'}}` and nothing else, so a refusal the CSM can fix is never hidden behind it. `j`'s `cockpit_kickoff_submit` (unchanged; the test reads its source) returns the check's errors as `{ok:false, reason:'invalid'}` before any INSERT. Only characters JSON writes as six-byte escapes (control characters) can reach it: the sheet's maxima fit in any script |
| `cockpit_clickup_writeback_audit()` (round 4) | replaced; guard live `d595491be9d1cac3e385382a2e84814a` (`20261026t`'s body, the same md5 in PGlite), after `4127726aa23cffe1ce78fc5ceafb8292` | **service_role, kept** (its live grant; deliberately not in this file's REVOKE list) | `20261026t`'s, plus one change: on any `cockpit_clickup_writeback_queue` row, before and after, `payload.taskComment` is removed and `payload.taskCommentChars` = its `char_length` (null when it is not text, never 0). A `task_action` row's `text` is still kept as its length; every other table, kind and key is audited whole, as before. So the handoff a request part carries (with the client's phone and email in it) never reaches `cockpit_audit_log`. Live 2026-11-02: 0 audit rows hold a `payload.taskComment` (11.2-x) |
| `cockpit_form_responses_answers_check` on `cockpit_form_responses` (round 4) | CHECK replaced (guard: `20261102f`'s exact definition, read live 2026-11-02 and equal to PGlite's rendering, or this file's; anything else stops the file with `cockpit_form_responses_answers_check changed since 20261102f; stop and re-read it.`) | | `new_client` and `onboarding` 1,048,576 bytes as before, **`kickoff` 262,144** (was 65,536), every other form 65,536. The sheet's maxima (12 long texts × 4,000 plus 6 short or url texts × 500) are about 105 KB in Arabic and about 207 KB at four bytes a character; the planner's largest step then is about 260 KB, well under the 2 MB plan CHECK. Live answer sizes 2026-11-02: kickoff 8 rows (pointer rows, at most 89 bytes), onboarding 46 (at most 19,736 bytes). Applying it takes a brief lock on `cockpit_form_responses` |
| `cockpit_form_onboarding_typeform(jsonb)` (round 4, review) | replaced; guard live `25a794296916c1e01447633d308cecc7` (`j`'s), after `ddefa9130061bc21b8b05c882d778d72` | **service_role, kept** (forms-door; `j`'s grant, deliberately not in this file's REVOKE list) | `j`'s, plus one change (`o` item 16): the answers `j`'s mapping gives go through `cockpit_form_stage4_numbers` with the schema of the version they are stored on, so a version-2 answer that came through the Typeform door holds `lastRevenue`, `goal90` and `goal12` as JSON numbers, as the portal sends them. One stored shape whichever door; Make's texts print `'250000'` and `250000` alike |
| `cockpit_form_stage4_numbers(jsonb,jsonb)` (round 4, review) | new, `IMMUTABLE` | owner only | for each question the schema types `number`, a text answer written as the cockpit writes a number (`^-?[0-9]+(\.[0-9]+)?$` and `trim_scale(x::numeric)::text = x`) becomes that number; any other text (`2 million`, `060000`, `60000.50`, `1e6`) is kept as it came; with no schema, or answers that are not an object, nothing changes |
| `cockpit_form_versions` `onboarding` version 2 | data, changed in place (`j`'s row; guarded above) | | `address`, `hours`, `landmark` and `appointmentLength` become `longtext`; every `text` takes `maxLength` 1,000 and every `longtext` 10,000. **Round 4 (B3, Typeform's inputs):** `lastRevenue` (`7ff5d37a`), `goal90` (`791b99b8`) and `goal12` (`f4b96a9b`) become `{type number, min 0, max 1000000000, decimals 0}` (no `maxLength`; stored as a JSON number and printed in Make's texts as Make prints Typeform's number, 0 blank); `website` (`454a425f`), `instagram` (`adecfe45`), `facebook` (`575d17ed`) and `driveLink` (`64d23c81`) get `{maxLength 1000, format url}` (the portal writes `https://` before a `www.` or a bare domain); `mapsLink` (`f7f9f2eb`) stays plain (1 of 24 past answers is not a link); the three phones keep format `phone` at 1,000 characters. No label, hint or required flag changes (the test proves it). Everything else is `j`'s. Schema md5 after `bc89ca36000ebf7943c6ec569cd1be73` (round 3's was `2b9cd946…`). One audit row `forms.stage4_long_texts` (`cockpit_forms_audit`, actor `migration 20261102o`); the registry's copy changes too only when the onboarding is already live on version 2 (live 2026-11-02: `typeform`, version 1). The in-place window is the one guard above: 0 responses and 0 invites on version 2 (live 2026-11-02: 0 and 0); after the first invite any change needs a version 3. The longest of the 46 stored `KFRCXPFx` answers, in characters (counts only, 11.2-w): `mapsLink` 431, `projectsDone` 224 and `appointmentLength` 204 (all three over `j`'s 200), `faqs` 2,695 (over `j`'s 2,000), then `challenges` 1,576 and `marketing` 1,370; under `j`'s definition four questions would have refused a real answer, under `o`'s none. Every past answer passes round 4's inputs: revenues 138 of 138 plain whole numbers, links 46, 46, 46 and 19 of 19 https, phones 138 of 138 E.164 |

Unchanged: `cockpit_form_stage4_input` and `cockpit_form_parity_plan` (`j`'s; they read the replaced field list,
hidden values and answers list by name), `cockpit_form_stage4_native_answers`, `cockpit_form_store_answer`,
`portal_form_submit` and `cockpit_kickoff_submit` (they call the two checks by name), both effects arrays, the relay
outbox, `stage4.messages`, and every effect not named above. `o` writes one audit row (`forms.stage4_long_texts`),
posts nothing, writes no card, sends nothing and reaches no sheet. Fifteen of its seventeen functions (six new,
nine replaced) are revoked from PUBLIC, anon, authenticated and service_role (owner only, as `i` and `j` left them);
the other two keep their live grant (service_role): the queue's audit trigger function, as `20261026t` left it, and
the onboarding Typeform door, as `20261102j` left it.
`cockpit_form_stage4_fields` stays at its round-3 after md5 `2b874cb1…` on purpose: typing the revenues `number` there
would make the Typeform door (X26, `j`'s `cockpit_form_stage4_native_answers`) store numbers, but it changes `j`'s
parity plan's `read_model` for a Typeform revenue such as `60000.50` (it becomes `60000.5`) and so breaks "every
effect not named is `l`'s, byte for byte". The door's own body does it instead (the two rows
above, `o` item 16): after `j`'s mapping, `cockpit_form_stage4_numbers` turns each version-2 number question into a
number, so a version-2 answer has one shape whichever door it came through; every text prints it the same way, and
a test proves the door's stored answers equal the portal's (`stage4-native-supabase.test.ts` 43 of 43). Also unchanged in round 4: `cockpit_form_schema_check` (number with min, max and decimals,
and the url and phone formats, were already supported; after md5 stays `07f88396…`), `cockpit_form_stage4_build`
`a565db2d…`, `cockpit_form_stage4_hidden` `c43644ee…`, `cockpit_form_stage4_typeform_answers` `c9ad150b…`,
`cockpit_request_create_system` `45207dde…` and `cockpit_form_stage4_plan` `1b13ba43…`.
`guard_check.py supabase/migrations '20261102o*'` read 2026-11-02 (round 4, after the review): `n` 11, `live` 10, `odd` the builder (live
holds `j`'s until `l` applies; then it reads `l`'s after value); with `'20261102[lop]*'`, 16 rows, 13 live, `odd` the
builder twice (`o`'s and `p`'s rows) and `p`'s effects row (waiting on `l`), all as expected (round 3, before the
rename: `'20261102[lm]*'`, 11 rows, 10 live; 11.2-w).
PGlite: `stage4-match-make-supabase.test.ts` (47 pass; 33 in round 3, 14 added for round 4) cuts the functions it needs from their migrations,
proves each replaced body is the live one (`l`'s for the builder), keeps `l`'s under `_l` names and `i`'s checks
under `_i` names, and compares every effect with `l`'s and with the evaluator, the native typing end to end
included. `stage4-native-supabase.test.ts` (40 pass) now applies `j`, `l` and `o`; each assertion `o` changes
carries a comment beside it, `l`'s own cases restore `l`'s state inside their rolled-back step (`lState()`), and a
portal case runs `portal_form_submit` end to end with line breaks and spaces kept and the longest stored answers
taken. Two more run the chain at `o`'s limits: every onboarding long text at 10,000 Arabic characters through
`portal_form_submit`, then a kickoff with its 12 long texts at 4,000 (nothing fails; the raw answers comment, the
read model and the handoff are each over 128 KB and whole), and a read model past 2 MB (`handoff_comment` and
`onboarding_tasks` fail with their reason, every other step runs, no request is made and the kickoff returns ok).
Round 4's twelve cases (in `stage4-match-make-supabase.test.ts`): the rooms (256 KB kickoff, 1 MB New Client Form and
onboarding, 64 KB others), the guard on `20261102f`'s check, a second apply and the audit function's grant; revenues
refused for `"2 million"`, `"1,500,000"`, `"1500000"` as text, -1, 1.5 and 1,000,000,001, and accepted for 0, 1e9,
60000.0 and 1.5e6; a native 1500000, 0 and 1e9 printed exactly as `make_parity.py` prints Typeform's numbers in the
Client Profile, the raw answers comment and the kickoff link's values; the Typeform door's answers list equal to the
portal's; links https with `mapsLink` plain; 14 typed phone shapes reaching E.164 and 10 refused (no country code, too
short or long, an extension, two numbers, `---`), every other form matching `i`; three synthetic answers in the stored
answers' shapes; the audit rows of a native kickoff's two part inserts and two state updates holding
`taskCommentChars`, no `taskComment` and none of the handoff's invented email or phone, `task_action` masked as before,
other kinds whole, a non-text `taskComment` giving null; Arabic maxima (over 64 KB, under 120 KB) stored, and refused
with 23514 under `20261102f`'s check; four-byte maxima (over 200 KB, at most 256 KB) stored; control-character maxima
giving `{_answers: too_large}` (and the table refusing them too), only that error when it is the only one; long
Arabic onboarding answers giving a largest plan over 128 KB and under 1 MB with no too-large step.

### 2.10 `20261102p_stage4_better_data.sql` (round 4, X39)

Written after the CEO's "You can even improve what's already there with the data that you have. So you can add more
if it gives us better data." (X39). Make's output, as `o` plans it, is the floor and stays exactly as it is: the
handoff comment (on the card and as each onboarding task's `comment_text`), the raw answers comment, the Client
Profile and Kickoff Form Link, the nine dropdowns and the Blueprint link, both map moves and the dispatch's two keys.
Every addition goes into a slot Make leaves empty (a task description), an effect of its own (`card_facts`) or a
cockpit-only surface (the kickoff notice's facts). It stands on `o`: unless the builder's md5 is `o`'s `a565db2d…` (or
its own after value) it stops with `Apply 20261102o before 20261102p.` (`55000`). It applies twice and copies `o`'s drift
guard: each replaced body must be the value below or this file's own, else `<function> changed since 20261102o; stop and
re-read it.` (`55000`). It posts nothing, writes no card, sends nothing and reaches no sheet.

| Object | Kind | Grant | Notes |
|---|---|---|---|
| `cockpit_form_stage4_build(jsonb)` | replaced; guard `o`'s after `a565db2d881852ff3a1481a438768e20`, after `5f52c05d01472cc80a9706f0d726a190` | owner only | `o`'s body plus the additions, by the repo's full-body convention. The kickoff's `onboarding_tasks` plan gains `details` (the brief, B1), `detailsKind 'brief'` and one line, `Cockpit brief in each task's description (N characters)`; the onboarding's `brand_dna_task` plan gains `details` (B2), `detailsKind 'dna_brief'` and `Cockpit brief in the task's description (N characters)`. `card_facts` comes after `card_fields` (kickoff) and after `profile_fields` (onboarding). A second kickoff plans only the handoff comment, as before, so `card_facts` is skipped too. Every other byte of every effect equals `o`'s (the test keeps `o`'s builder as `_m` and compares over 96 combinations of settings, request types, stored card and inputs; Make's texts with `toBe`) |
| `cockpit_form_stage4_effects(text,integer)` | replaced; guard `l`'s after `1b01ccc56e88b8fa4f4fc8985d36c93c`, after `a9cb7e47d632bb8147b0cf4ad1ce2e44` | owner only | both version-2 arrays gain `card_facts` (`clickup_queue`, owner `cockpit`): kickoff after `card_fields`, label `Empty card fields filled from the kickoff` (10 effects); onboarding after `profile_fields`, label `Company Website on the card, when empty` (8 effects). Both version-1 arrays are unchanged (4.15.2) |
| `cockpit_slack_notice_kickoff_facts(text,text,jsonb,text)` | replaced; guard live `3ecb0f63f577ec3712789bdad68bded8` (`20261025n`'s), after `4e47c07ef41f98fc84e258dcb51eb5a2` | owner only (its live ACL) | `20261025n`'s, plus `openItems` (B4) read from `p_forms->kickoff->answers` by ref through `cockpit_form_stage4_open_items`: absent when none of the setup questions is answered (no stored kickoff answers, or none of these), `[]` when every answered one is done. Everything else in the facts is `20261025n`'s |
| `cockpit_form_stage4_task_brief(text,jsonb,timestamptz)` | new, `STABLE` | owner only | B1's brief (4.16): `From the onboarding and kickoff forms (cockpit)` first, 3,600 characters at most. Drop order past 3,600, each line becoming a short pointer: 1 Services and prices (to the Raw Onboarding Form Answers comment), 2 Consultants and 3 Hours (to the handoff comment on the task), then 4 Service areas, 5 Payment options, 6 Landmark, 7 Appointment length and buffer, 8 Furthest they travel, 9 #1 service, 10 Booking software, 11 Meta Business Manager, 12 Free consultations, 13 Years in business, 14 Projects completed, 15 Front desk phone, 16 Appointment types, 17 Services advertised, 18 Call recording; past every level, the short brief (heading, read line, cockpit client page) |
| `cockpit_form_stage4_dna_brief(text,jsonb,text)` | new, `STABLE` | owner only | B2's brief: `For the Brand DNA doc (cockpit)` first, 3,600 at most. Drop order: 1 Service areas, 2 Payment options, 3 Ideal project, 4 Why they joined, 5 Free consultations, 6 Appointment types, 7 Years in business, 8 Projects completed, 9 #1 service, 10 Website, 11 Instagram, 12 Facebook, 13 the typed business name; then the short brief |
| `cockpit_form_stage4_card_facts(text,text,jsonb,timestamptz)` | new, `STABLE` | owner only | B8's effect: `{key card_facts, delivery clickup_queue, plan {taskId, fields, lines}, skip?}`; each field `{fieldId (full id), kind, label, optionIds \| optionId \| value, onlyIfEmpty: true, source}` (sources `kickoff`, `call_store`, `kickoff_day`, `onboarding`; a date is a Kuwait day `YYYY-MM-DD`). With no field to plan the effect is skipped with a sentence, never queued |
| `cockpit_form_stage4_open_items(jsonb)` | new, `IMMUTABLE` | owner only | B4's items as fixed labels: a choice only when it is one of the form's own options (`cockpit_form_stage4_fields('kickoff')`), so a typed or unknown answer counts as unanswered; NULL when none is answered |
| `cockpit_form_stage4_onboarding_call(text,timestamptz)` | new, `STABLE` | owner only | the card's newest `cockpit_csm_calls` row of kind `onboarding`, source `fathom`, not cancelled, no-show or gone, started in the 3 days up to the kickoff, and placed on the card by an exact sign or a person (A7.14 rule 2 as `cockpit_form_recording_tied` reads it: `match_method` `same_room`, `appointment_time`, `form_task_id`, `manual` or `client_id_field`, or `invitee_email` at 0.9 or more; a name at 0.6 or a company-domain `invitee_email` at 0.8 settles nothing): `{id, startsAt, recordingUrl}` (an https recording only). Both the B1 recording line and `card_facts`' `call_store` source read it |
| `cockpit_form_stage4_cut`, `_link_kind`, `_brief_line`, `_brief_join`, `_link_flags`, `_details_note` | new (`IMMUTABLE`; `_details_note` `STABLE`) | owner only | small readers: a value cut at N characters with `…`; what a link is (instagram, facebook, social, link_in_bio, google_maps, google, site); one brief line with its drop rank and pointer; a brief at one drop level; the three social links' checks; and the sentence a plan carries when its request type has no field keyed `details` |
| registry rows `kickoff`, `onboarding` | data | | a row holding `l`'s (and `o`'s) version-2 array, after a go-live, takes `p`'s, with one audit row each through `cockpit_forms_audit`, action `forms.stage4_card_facts`, actor `migration 20261102p`. A row on version 1, or already on `p`'s version 2, stays as it is; any other array stops the file (`The <form> effects changed since 20261102l; stop and re-read them.`). Live 2026-11-02 both rows are on version 1, so nothing moves |

**The brief and the request types.** Both briefs travel the existing path: the plan's `details` is handed to
`cockpit_request_create_system`, which keeps details only for a field keyed `details`, and `cockpit_request_plan`
prints them in the description only for a field of kind `details` (`docs/requests/CONTRACT.md` 2.2 and 2.6). So the request
types `client_onboarding` and `brand_dna` must each be seeded with a field `{key: 'details', kind: 'details'}` (D-S4F
(9)). When the type exists with no field keyed `details`, the plan's lines and `plan.detailsMissing` say `The brief stays
out of the task description: the <type> request type has no details field. Add one (key details, kind details) to
carry it.`, and the parity run reads `differs: the brief would be dropped (the type has no details field)`. The effect's
top-level `missing` is not used for this: `o`'s planner marks such an effect failed and makes no task, which would fall
below Make's floor. The tasks are still made.

**Ship order.** `clickup-writeback` with `card_facts` (`STAGE4_KEYS`, `factsStep`) is live before `p` is applied (D-S4F
(2)); otherwise a canary kickoff's `card_facts` queue row fails as a mismatch. The notices' `text.ts` can ship in either
order: a missing `openItems` prints no line. If a go-live happens before `p` is applied, `p` moves the registry row
itself (above). Re-applying `l` by hand after `p` while a go-live is on stops in `l`'s registry step, which does not
know `p`'s array; a normal one-time `l`, then `o`, then `p` is not affected.

`guard_check.py supabase/migrations '20261102p*'` read 2026-11-02: `n` 3, `live` 1 (the kickoff facts), `odd` the builder
and the effects (chained on `o` and `l`, as expected); after D-S4F (1) and (3) both must read their earlier after values.
All fourteen functions (eleven new, three replaced) are revoked from PUBLIC, anon, authenticated and service_role and
are `SECURITY DEFINER` with an empty `search_path`. PGlite: `stage4-better-data-supabase.test.ts` (new, 34 pass, 935
expects) and `stage4-native-supabase.test.ts` (43 tests: `p` added to its chain and its second pass, assertions `p`
changes marked `20261102p`, three new `p` cases; 43 pass). If `o`'s builder changes again, `p` stops with
`Apply 20261102o before 20261102p.`: rebase `p`'s builder on the new body, update the `a565…` constant in `p` and in
the test, and refresh the after md5s.

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

A `hint` may hold line breaks (`\n`, one item per line: the onboarding's Drive checklist since `20261103b`, 4.18)
and an `https://` link in its text. The schema stays the same; the portal shows each line (`white-space: pre-line`)
and makes a link only of an allowlisted host (`app.leadsie.com`), any other URL staying text (P1).

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

**The client onboarding's texts** (`20261102o`, 2.9, X37). The `onboarding` form alone keeps a `text` or `longtext`
answer as Typeform keeps it for Make: a carriage return becomes a line feed, white space at either end goes, and
every line break and repeated space between stays (`cockpit_form_typeform_text`). Its schema may give a text up to
1,000 characters and a long text up to 10,000, the room `KFRCXPFx` took. Every other client form folds each run of
white space to one space and keeps 200 and 2,000, as before. The portal's parser, its answer cleaner and its
copy of the definition must learn the same before the onboarding opens to clients (11.9).

**Typeform's typed inputs on the client onboarding** (`20261102o` round 4, B3, X39). `KFRCXPFx` asks the three
revenues as number questions, the four links as website questions and the three phones as `phone_number` questions,
so Make has only ever seen a plain number, an https link and an E.164 phone there. Version 2 asks them so too, with
no change of wording: `lastRevenue`, `goal90` and `goal12` are `number` from 0 to 1,000,000,000 with 0 decimals (a JSON
number; `"2 million"`, `"1,500,000"` sent as text, -1 or 1.5 get `range`), printed in Make's texts as Make prints
Typeform's number (0 blank); `website`, `instagram`, `facebook` and `driveLink` have format `url` (the portal writes
`https://` before a `www.` address or a bare domain; anything else without `http(s)://` gets `format`); `mapsLink`
stays plain; `phone`, `frontDeskPhone` and `personalPhone` are stored as E.164 by the answers check (2.9), and a number
with no country code gets `format`. Every other form's phones, links and numbers are checked as before. The portal
mirrors every rule character for character (`e164Phone`, `typedLink`, `maxLengthCap`, `typeformText`) and its copy of
version 2 carries `o`'s md5 `bc89ca36…` (its own test; portal `docs/CLIENT-FORMS.md`).

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
   `j`, 46 since `20261102o` adds the five follow-ups Make 12 [11] prints, makes Post call form filled
   a Yes or No choice and Who else should we add to the WhatsApp group? a long text, as `tG7dnxBn` asks them,
   2.9; a long text keeps its line breaks and spaces, a short text is folded), plus **New MRR** (`newMrrUsd`, number ≥ 0,
   required, label `New MRR (USD a month)`, hint `What this client pays us each month from now. 0 if
   they paid in full with no monthly fee.`). Prefill (`cockpit_kickoff_prefill`): the 23 hidden fields
   the cockpit fills today (`apps/client-success-cockpit/src/forms/prefill.ts`, from the onboarding
   answers and the card), the card's MRR for New MRR, each with its source chip. Since `20261102o` the
   hidden values are what Make 13 [29]'s Kickoff Form Link carries for the card's onboarding answer
   (`cockpit_form_stage4_hidden`): as stored, untrimmed, the appointment types joined with `,` as ticked,
   a revenue of 0 empty, and no business name taken from the card.
2. **Submit** (`cockpit_kickoff_submit`) then **the read model**: `cockpit_client_onboarding.forms.kickoff`
   = `{form_id:'native', response_id, answers:[{ref, title, value}] (Typeform shape, by `typeformRef`; a
   list in the order it was ticked since `20261102o`),
   payment (the "Payment Amount" `75e97e7d` value), recording (`b5578678`), submitted_at}`, so
   `growth.js`, Pending payments and the Blueprint prefill (`20261024a:602`) read it unchanged.
   `growth.js` drops only `KICKOFF_FORM` from its filter (`form_id IN ('tG7dnxBn','native')`).
3. **Effects** (`cockpit_form_stage4_plan`), the Make 12 parity table (8925654, 11.2-p):

| Make module | Effect key | Delivery | Native write | Intended difference |
|---|---|---|---|---|
| [11] handoff comment | `handoff_comment` | `clickup_queue` (kind `form`) | Make 12 [11]'s text, built in SQL (`cockpit_form_stage4_handoff_text`, 2.9): its 110 lines, `Not provided` for an empty hidden value or answer, `Yes` or `No` lines by `switch` (`Not provided` for any other answer), Payment Amount 0 `Not provided`, lists as ticked, hidden values from Make 13 [29]'s link | none: byte for byte (X37; the parity run compares the bytes, 4.15.1), posted as Make's text alone, with no ref line, and still exactly once (4.13.4) |
| [20] native status | `native_status` | `clickup_queue` | task status `IN PROGRESS` | none |
| [21] card fields | `card_fields` | `clickup_queue` | Client Status = Brand Blueprint Booked (option by id from the field map); the nine dropdowns by `cockpit_form_option_maps`, Service Advertised `bab9a58b` being the option ticked first (Make's `switch(first(…))`) and nothing when that one is not an option (`20261102o`); 🧬 Brand Blueprint Form Link `1b7a4a74` = the cockpit Blueprint link | the Blueprint link points at the cockpit Blueprint (PV's pass condition), not `oYZKtogO` |
| (none: Make leaves these fields alone) | `card_facts` (`20261102p`, B8) | `clickup_queue` (kind `form`) | only while the card leaves each field empty: Consultation Types `45fdd2ea` (labels, from the kickoff's appointment types), ADs Platform `2de15aa5` (drop-down, when the answer names exactly one platform), Fathom `abaa31ee` (url: the kickoff's recording when it is a fathom.video link, else the stored onboarding call's), Onboarding Call Date `ee9bf855` (date: that call's day, else the day the kickoff was sent, Kuwait). The writer reads the card fresh, writes only an empty field and keeps a set one (4.16) | an addition on top of Make (X39): `intended: card_facts` |
| [17][18] Technical Onboarding task + comment, [22][23] Creative Onboarding task + comment | `onboarding_tasks` | `sql` (registry delivery) | a request: new type `client_onboarding`, two targets: Operations / Tech `901816723190` template `t-86ex8x9xw`, Media/Creative `901818016338` template `t-86eyu1w3d`, through `cockpit_request_create_system`, requester the submitting CSM; each task made from its template, then the whole handoff (the same bytes as `handoff_comment`) posted once on it as a comment, Make's text alone, by the request writer's `task_comment` step (4.13.4): the plan's `comment_text`, kept on `cockpit_requests.task_comment` and in each part's queue payload as `taskComment` (`20261102o`), never through the details, which stop at 4,000 characters while real handoffs reach 4,656. Round 3's plan carried no details; since `20261102p` (B1, X39) the plan's `details` is the **cockpit brief** (`detailsKind` `brief`, first line `From the onboarding and kickoff forms (cockpit)`, 3,600 characters at most), which the request route writes into each task's description under its heading; the handoff stays each task's comment, alone. (This row said "the handoff text as the task description" until 11.9: Make's [17] and [22] write no description, and [18] and [23] post comments) | the comment: none, byte for byte. One task each per card (Make doubles them on a second submit; the per-card dedupe of 2.6), named `{client} - {type label}`, as `make_parity.py` reads it. What the request route adds to each task (its description and marker, due date, priority, owner, tag, Request Type, the card's link comment) is intended since X39 (`request_route`), as is the brief (`brief`); the route stays (X38) |
| [26][27] Onboarding Map phase 4 | `map_phase4` | `clickup_queue` | `51f49cb1` = `onboarding.map_urls.4` | none |
| [24] Client Data search (`google-sheets:filterRows` on column C, read at D-S4.0: no write), [28] wait, [25] phase 4 WhatsApp | `phase4_whatsapp` | `client_message` kind `phase4` | a draft with `stage4.messages.phase4`: Make's text with `{map_link}` (filled by the SQL) and `{content_folder}` (kept in the approved text; `hermes/client-messages` puts in the card's Client Data column H link at send, X35), approved by the CSM | waits for the CSM's approval (2b rule) instead of 30–120 s; skipped with a reason when Client Data has no group, as Make's filter; refused with a sentence to add the Google Drive Link in Client Data column H when the card's link is missing or not a link, where Make sent a blank line |
| (none) | `kickoff_notice` | `slack_notice` | the Stage 1 kickoff notice, already cockpit-owned; since `20261102p` (B4) its facts carry `openItems` and both variants print one line after the handoff line: `Still open from the kickoff: <a>; <b>.` or `Nothing open from the kickoff's setup questions.`, and no line without stored kickoff answers (4.16) | none (Make posts no notice) |
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

   **`card_facts`** (round 4, B8, X39; `forms.ts` `factsStep` and `writeFacts`): the eighth Stage 4 key, accepted on
   either form. `CARD_FACTS` is the writer's own allowlist: exactly the five full field ids, each with its kind and
   name, and for the two choice fields the allowed option ids from the s40 snapshot (Consultation Types `82279634`,
   `387c686d`, `d9c0f5a6`; ADs Platform `88d55b4b`, `c115bdfe`, `97b22a7b`). `forms.ts` names no Country, Daily Budget or
   ADs Platforms id. Before any call the plan must hold 1 to 5 fields, none twice, each in `CARD_FACTS` with its own
   kind, `onlyIfEmpty` strictly `true` and a string label; labels need `optionIds` (non-empty, unique, allowlisted), a
   drop-down `optionId` (by id; a name alone is refused), a url an https value, a date `YYYY-MM-DD` (a real day), a
   millisecond instant or an ISO instant with its zone, in 2020 to 2099 (an optional `day` must agree). Anything else
   fails the row with the mismatch sentence and makes no call. The writer reads the card fresh: every planned field
   and every option it would write must be on the card first (else `noField` / `noFieldOption`, or
   `noFieldOptionStarted` on a resumed step). Empty means no value, `''`, white space or `[]` (a drop-down at orderindex
   0 is set). Each empty field is POSTed once (a date at noon Kuwait, `time:false`) and the card read back once. A set
   field is never written or added to: it is `kept`, with `differs:true` and the note `kept: the card already has
   another value` when it is not the form's. The receipt, `progress.steps.card_facts.fields[fieldId] = {before:
   'empty'|'set', state: 'due'|'written'|'kept', differs?, note?}`, is saved before the first write and holds no value
   (the audit trigger copies progress whole); a delivered row's effect carries it as `receipt.step.fields`. A resumed
   step goes by the saved `before`, so its own earlier write is never taken for the card's value; a field showing
   another value after our write is kept with `kept: another value reached the card during this write`. Anything
   written: step `done`, row `delivered`; when it kept a field too, the kept sentence below rides on it as the queue
   row's `error` and as `progress.steps.card_facts.note` (the effect reads it as `receipt.step.note`; a delivered
   effect's `reason` stays empty). Nothing written: step and row `skipped`, with `kept: the card already has a
   value for <names>[; <names> differ(s) from the form, so check it/them on the card]`. A planned field still empty
   on the read-back halts the row `unknown`. Exactly once: a 429 or 401 clears the step only on the first write of a
   fresh step; later, the receipt survives and the row reads `unknown`, so the next run reads the card back first.
   ClickUp has no compare-and-set: a value another writer sets between our read and our POST, when our POST lands
   last, is overwritten unseen (the receipt still truly says `empty`; the window is one paced call). The held-row words
   in `planForm`: `Empty card fields filled from the answers` and `up to N, each only where the card is empty`, no values.
   The forms doctor (`{"job":"forms_doctor"}`), while `kickoff` or `onboarding` is in `CLICKUP_WRITEBACK_FORMS_KEYS`,
   checks live that each of the five fields is on Clients - Mahara with its ClickUp type and every allowlisted option,
   one plain sentence per problem.

   **The comments that mirror Make's** (`handoff_comment`, `raw_answers_comment`, and the handoff on each
   onboarding task, below) carry Make's text alone, with no `Cockpit ref` line (X37, X38), and are still
   posted exactly once. Once ClickUp answers the POST with an id, the comment is found again by that id and
   nothing else, and never posted a second time: an answered comment that is gone reads `unknown`, with `ClickUp
   answered the {comment} with its id, but the comment is not on the card now. It is not posted again: check the
   card in ClickUp.` With no id, it is found by its text among the card's (or task's) comments dated at or after
   the step's start less 60 seconds, paged back as `findComment` pages. Texts are compared after `commentKey`
   (`requests.ts`), which undoes what ClickUp does to a comment it stores: a backslash before ASCII punctuation
   goes (ClickUp's markdown escapes, as `holdsMarker` records for `tech\_two`), then every rule line of three or
   more `_` or `-`, then every `*`, and each run of spaces and new lines (`\r\n` and `\r` too) becomes one space,
   none at either end. The evidence: `make_parity.py`'s fidelity check reads the comments ClickUp holds on 12 of
   12 real cards with exactly those changes (4.15.1, `test_fidelity_reads_clickup_as_it_returns_comments`), and
   `cockpit-csm-api` reads plain text back byte for byte; no production table holds a ClickUp comment body, so
   D-S4K checks it once on the test card. With no id and no comment matching, the next run takes the first POST as
   never landed and posts again, so where ClickUp answers without an id, exactly once rests on `commentKey`. The
   keys must be equal (never `includes`): one line, or one word, more or less is another comment, a text that keys
   to nothing never matches, and a comment ClickUp shows with no date counts as possibly this one, as a checklist
   does. A row the writer before this one started (its comment
   ends with `Cockpit ref F-…`) is found by that line or by the text, and a step it froze with the line is posted
   without it. The to-do comment, the request's card link comment, a routed ticket's comment and every other
   cockpit comment keep their markers. A Stage 4 text field (the Client Profile) and link field are written as
   long as Make writes them: only the kind and, for a link, `https` are checked, and a value ClickUp itself refuses
   is reported like any refusal.

   **The task comment** (`requests.ts`, the request writer): `REQUEST_STEPS` is `create, description,
   owner_due_priority, checklist, tag, fields, request_type, task_comment, card_comment, replaces`. A part gets
   `task_comment` only when its payload holds a `taskComment` that is a non-blank string (today only the two
   onboarding tasks, `20261102o`). It reads the task first, so a task ClickUp no longer has stops the part before
   anything is posted again, then posts `{comment_text: taskComment, notify_all: false}` exactly as given and
   finds it again as above. ClickUp refusing it for good leaves the part delivered with the note `The comment did
   not post on the task in ClickUp. The task itself is there: copy the Kickoff Handoff comment from the client card
   onto it.`; a read-back miss is `unknown` with `The comment on the new task did not read back. The next run
   looks for it.` A payload whose `taskComment` is not text, or is over 2,097,152 UTF-16 units (the 2 MB a
   kickoff plan holds, 2.9; a text's UTF-16 length never passes its UTF-8 bytes, so every handoff the cockpit plans
   fits), fails before anything reaches ClickUp: `This request's comment for its task is not
   text, or is longer than any the cockpit makes, so nothing was written. Tell the tech lead.` The dry run shows
   `comment on the new task` with its length in characters, never its text, and a part's progress keeps only the
   step's state and the comment id. **Ship order:** a part freezes its steps before its first write, so a part
   frozen by the writer before this one never posts its `taskComment`; this writer deploys before `20261102o` is
   applied (D-S4F (2)). A comment the API account posts with no ref reads as the CEO's (quiet) in the task alerts
   (`cockpit_task_comment_author`, `20261026t`), as Make's did, since Make posts as the CEO's ClickUp account;
   `comment-watch` classes the handoff `kickoff`, as it classes Make's.

### 4.14 Stage 4: client onboarding, native (stage4 for SQL and workers; portal-56 for the page)

1. **Schema** (version 2, client schema v1, 5.9): the 33 questions of `KFRCXPFx` (11.2-o) in the
   Typeform's order with their existing wording (the stored `answers.fields[].title`; the missing
   language drafted under the voice skill and listed in the slice report, then shown to the CEO in
   the forms editor before D-S4O, 1.3), `heading` items for its three screens, prefill context from
   the New Client Form answers the cockpit stores (`cockpit_form_responses` `new_client`: business
   name, the closer's notes) and the card (since `20261103g`, 4.19, the business name is the card's
   newest tied sale's own answer `a1be4eee`; before it the read matched no stored sale). **Branching ("onsite logic", plan 5.16):** the builder
   derives which questions are conditional from the 46 stored answers (a question absent from some
   answers) and expresses each as schema v1's single-equality `showIf`; a test asserts the renderer
   and the SQL checker hide the same fields. D-S4.0 reads the saved definition's `logic` and stops if
   any jump is not a single equality on an earlier field (the schema is then extended on the branch
   first). Since `20261102o` (2.9, 3.6) the four questions `KFRCXPFx` asks as `long_text` (`address`,
   `hours`, `landmark`, `appointmentLength`) are long texts, every text takes 1,000 characters and every long
   text 10,000, and each answer is kept as typed (line breaks and spaces; a carriage return as a line feed; no
   white space at either end), as Typeform hands it to Make. Since round 4 (B3, X39; 2.9, 3.6) the three revenues are
   numbers (0 to 1,000,000,000, no decimals), the four links have the url format (`mapsLink` stays plain) and the three
   phones are stored as E.164, as `KFRCXPFx` asks them; no question's words change. This in-place change is allowed only
   while version 2 has 0 answers and 0 invites (read-only check, guarded in `o`). Since `20261103b` (B0, 4.18; the
   CEO's "Yes" to CEO-3) version 2 also carries `KFRCXPFx`'s nine hints, its optional `address`, `projectsDone` and
   `landmark`, "(in English)" on the Business Name label and the fifth Meta choice `restricted`, under the same
   guard (md5 `38d371cd…`).
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
| [25] GitHub dispatch `market_intel` | `github_dispatch` | `relay` | the same `repository_dispatch` (owner, repo, event type and payload keys read from the saved blueprint at D-S4.0, written into `~/.forms-relay/config.env` at D-S4F); the client name is the typed Business Name answer (`514bfd3f`) exactly as typed, empty when there is none, and the id is the card (`20261102o`; the payload key the relay reads stays `client`). The payload is exactly `{client, taskId}`: extra keys wait on the CEO's CEO-1 (section 10; `DISPATCH_EXTRA_KEYS` is empty) | none, except a name holding a double quote, a backslash or a line break: the relay sends it escaped, where Make's [25] pastes it into its JSON unescaped and fails (11.9) |
| [29] Client Profile + Kickoff Form Link | `profile_fields` | `clickup_queue` | `7755485f` = Make 13 [29]'s text (`cockpit_form_stage4_profile_text`, 2.9): seven labels, each kept when its answer is empty, a revenue of 0 blank, never cut (Make has no limit; `clickup-writeback` writes a Stage 4 text of any length, 4.13.4); `87d7d889` = the cockpit kickoff link `https://cockpit.maharamedia.com/client-success/clients/{task}?form=kickoff` | the kickoff link opens the cockpit sheet, not a prefilled Typeform. The profile text: none, byte for byte (X37), whole. If ClickUp itself refuses a long value, the writer reports ClickUp's refusal like any other (real profiles run 352 to 1,233 characters) |
| (none: Make leaves it alone) | `card_facts` (`20261102p`, B8) | `clickup_queue` | Company Website `5d57fdde` (url) from the website answer (`454a425f`), only when it is an https link whose host is not a social, Google or link-in-bio site, and only while the card's field is empty (4.13.4) | an addition on top of Make (X39): `intended: card_facts` |
| [41][42][47] raw answers comment | `raw_answers_comment` | `clickup_queue` | Make 13's text (`cockpit_form_stage4_raw_answers_text`, 2.9): `**Raw Onboarding Form Answers**`, then each answered question in `KFRCXPFx`'s order as `**<its full title>**`, its answer and a blank line, a revenue of 0 blank; the full titles from `onboarding.raw_titles`, filled at D-S4F. While the setting is empty, malformed or has no title for an answered question, the effect fails with its sentence and nothing is posted | none: byte for byte (X37), posted as Make's text alone, with no ref line, exactly once (4.13.4) |
| [31] Client Data search (`google-sheets:filterRows` on column C: the card's row, where the phase 3 group is; read at D-S4.0) | none (it gates [49] to [48]: `map_phase3` and `phase3_whatsapp` run once per row it finds, 11.8) | — | nothing: Make writes no Client Data row, and `hermes/client-messages` reads the group (column F) and the content folder (column H) from the card's row itself | none; the `client_data_row` effect `j` planned (it appended a row when the card had none) is removed by `20261102l` (X34) |
| [49][50] Onboarding Map phase 3 | `map_phase3` | `clickup_queue` | `51f49cb1` = `onboarding.map_urls.3`, never moving the map back (4.13.4) | none, except a card already at phase 3 or later is kept |
| [51] wait, [48] phase 3 WhatsApp | `phase3_whatsapp` | `client_message` kind `phase3` | a draft with `stage4.messages.phase3` (`{map_link}` and `{content_folder}` as in phase 4, X35), CSM approval | waits for approval; skipped with a reason when Client Data has no group; refused with a sentence when the card's Google Drive Link is missing or not a link |
| route 2 [46] Brand DNA task | `brand_dna_task` | `sql` | a request: new type `brand_dna`, Media/Creative `901818016338`, no template and the fixed assignee, as Make 13 [46] (`createTaskInList`, read at D-S4.0), via `cockpit_request_create_system`; `o` gave it no details, as [46] writes no description (`l` put the raw answers text there); since `20261102p` (B2, X39) its `details` is the **Brand DNA brief** (`detailsKind` `dna_brief`, first line `For the Brand DNA doc (cockpit)`, 3,600 characters at most), in the task's description under the request's heading | none, except one per card (2.6), named `{client} - {type label}` as `make_parity.py` reads it. What the request route adds to the task (its description and marker, due date, priority, tag, Request Type, the card's link comment) is intended since X39 (`request_route`), as is the brief (`dna_brief`); the route stays (X38) |
| (cockpit) read model | `read_model` | `sql` | `forms.onboarding` Typeform-shaped, `form_id 'native'`, each list in the order it was ticked since `20261102o` (`cockpit_form_record_make` keeps refusing to overwrite a newer row) | none |
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
     since `20261102o` the dispatch sends the typed Business Name instead, X37). `oracle(form, saved, rec,
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
   The comments are graded as ClickUp receives them, not only as planned: `onboarding_tasks` reads `differs:
   nothing posts comment_text on the two tasks` while `TASK_COMMENT_STEP` is `None` (since round 3 it is
   `task_comment`, the request writer's step; `test_make_parity.py` fails while it and `REQUEST_STEPS` in
   `clickup-writeback/requests.ts` disagree), and a comment in `REF_LINE` reads `differs: the writer adds a
   Cockpit ref line Make does not post` (`REF_LINE` is empty since round 3; `test_make_parity.py` reads what
   `forms.ts` and `requests.ts` post, with a small TypeScript source reader proved on invented code, and fails
   while `REF_LINE` and they disagree). `onboarding_tasks` and `brand_dna_task` read `differs: the cockpit
   writes a task description Make does not` for a plan with details that is not a registered brief (Make 12 [17],
   [22] and Make 13 [46] write none; since round 4 the registered briefs are graded as additions, below). Service Advertised has no intended line: a service the cockpit
   writes where Make 12 [21] writes none differs.
   Fidelity keeps folding whitespace, because ClickUp rewrites a comment it stores. Phase texts compare as
   templates, `{map_link}` and `{content_folder}` intact. The last line is `PASS`, `FAIL` (any `differs`, fidelity included) or
   `NOT PROVEN` (no difference, but a setting missing), with the run and difference counts, and names
   the phase text that was not compared. Exit 0 only on `PASS`.
   Pass = `PASS` for both forms: every effect `equal` or `intended` and fidelity `equal` on every run.
   It prints ids, field ids, effect keys, run numbers and verdicts only: never a name, an answer, a
   phone number, a token or a key. Tests: `python3 scripts/dev/test_make_parity.py` (48 run, 1 skipped; 33 in
   round 3) on trimmed copies of the saved files in `scripts/dev/fixtures/make-parity/` (synthetic answers; the
   token header dropped, the repository and the fixed assignee replaced); with
   `MAKE_PARITY_SAVED_DIR` pointing at the saved files, the skipped test proves the fixtures equal them,
   trimmed.

   **Make's output plus intended additions** (round 4, X39). Make's part is graded byte for byte, always: the
   handoff comment, the raw answers comment, the onboarding tasks' `comment_text`, `profile_fields`, `card_fields`,
   `map_phase3`/`map_phase4` and the dispatch's two keys keep their verdicts, and any extra text inside them grades
   `differs`. Each effect prints one line: `equal + intended: <names>` when Make's part is equal and every addition
   is registered (an addition is named only when Make's part is equal; otherwise the line is `differs: …`), and
   `intended: <name>` for an effect Make has no part in (`notice`, `new_mrr`, `recap`, `read_model`, `card_facts`).
   Each run ends with a legend (`intended <name>: <why>`) before `PASS` or `FAIL`. `CEO_WORDS` holds the CEO's
   sentence, and the entries it covers (`request_route`, `brief`, `dna_brief`, `card_facts`) quote it.
   - `request_route`: what the request route gives each task beyond Make's name, list and template or assignee (the
     template's text and the `Cockpit ref` marker in the description, due date, priority, owners by rule, the client
     tag, the Request Type field and the card's link comment), listed as cannot-match in 11.9 until X39. It joins
     `task_name` and `dedupe` on both task effects.
   - `brief` and `dna_brief` (`SLOTS`): `details` is accepted only when its first line equals the header exactly
     (`From the onboarding and kickoff forms (cockpit)` for `onboarding_tasks`, type `client_onboarding`; `For the Brand
     DNA doc (cockpit)` for `brand_dna_task`, type `brand_dna`), `detailsKind` equals the slot, and it is at most
     `BRIEF_MAX` 3,600 code points (`char_length`). Over the cap: `differs: the <name> is N characters, over 3,600`; a
     wrong header or kind, the other slot's header, or a carriage return after the header: `differs: the cockpit
     writes a task description Make does not`.
   - A dropped brief is caught: the run reads `cockpit_request_types` `key, targets, fields` and needs a field with key
     `details` **and** kind `details` (`has_details_field()`); a missing field list counts as none, so the verdict is
     `differs: the brief would be dropped (the type has no details field)`.
   - `card_facts`: only the five full ids (`CARD_FACTS`: `45fdd2ea` labels, `2de15aa5` drop_down, `abaa31ee` url,
     `ee9bf855` date, `5d57fdde` url), each with its kind, `onlyIfEmpty` true, a non-blank `source`, a usable value
     (https on the whole text; a date `factDay` takes: a real `YYYY-MM-DD`, an instant with its zone or epoch ms, in 2020
     to 2099; option ids on the field map, none twice), a text `label`, a field Make does not write itself and no field
     twice; an empty field list needs the effect's `skip`. Country, Daily Budget and ADs Platforms (`CARD_FACTS_NEVER`) are outside the five. The writer's own receipt
     (`fact_receipt()`: the map `{fieldId: {before 'empty'|'set', state 'due'|'written'|'kept', differs?, note?}}` from
     the queue row's `progress.steps.card_facts`, the effect's `receipt.step` or the fields alone) grades `differs:
     overwrote a card value (<id8>)` for `written` over `before 'set'`, `differs: the writer wrote a field the plan does
     not name (<id8>)`, and any other shape `differs: the writer's receipt is not in its shape`; with no receipt the
     verdict reads `intended: card_facts (receipt not read)` and the summary says on how many runs (the exit code is
     unchanged). The VPS run reads the receipt with GETs only, when `card_facts` is planned. Which form fills which of the five is not enforced, by design.
   - The dispatch payload must be exactly `{client, taskId}`; `DISPATCH_EXTRA_KEYS` stays empty until the CEO decides
     CEO-1, and any of the five contact refs or keys anywhere in it reads `the cockpit sends a contact answer`.
   - Make's part is graded more strictly too: `card_fields` flags a field Make 12 [21] never writes and compares
     non-dropdown values; `profile_fields` flags any field Make 13 [29] does not write; an effect key outside
     `KNOWN_EFFECTS[form]` reads `differs: an addition no INTENDED entry registers`.
   `test_make_parity.py` reads `20261102p` by its full stem, `20261102p_stage4_better_data.sql` (exactly one file; never the goals sheet's `20261102n` once main is merged), and requires a SQL literal opening with each
   header, the `brief` and `dna_brief` kinds and the 3,600 cap; all five `CARD_FACTS` ids in `p` and in
   `clickup-writeback/forms.ts`, and none of the three never-written ids. Its negative tests all grade `differs`: an
   unregistered header (and the other slot's, a prefix that is not a line, a carriage return after it, a missing or
   wrong kind), `card_facts` over a set field, outside the five or without `onlyIfEmpty`, a dispatch with an extra key,
   a phone key or a nested contact ref, a Make-mirroring comment, raw answers comment or profile with a trailing block,
   a brief of 3,601 characters in either slot, and a dropped brief (no details field, `details` keyed with kind
   `text`, no field list). A test reads `FactReceipt`'s keys and words, the step key, `ZONED` and `factDay`'s
   range from `forms.ts`, so the two files cannot drift. Before D-S4K no receipt exists, so the VPS run grades the plan
   and says `(receipt not read)`; a skipped row's receipt is read from the queue row's progress (the effects trigger
   copies `receipt.step` only on `delivered`).
2. `cockpit_form_stage4_go_live(form, on, actor)`: on → registry provider `native`, version 2, the
   registry's `effects` replaced by `cockpit_form_stage4_effects(form, 2)`, `forms.stage4.<form>` true
   (and `onboarding` added to `forms.client.live` through `cockpit_form_client_go_live`); off → back
   to `typeform`, version 1, `effects` = `cockpit_form_stage4_effects(form, 1)` (the live arrays of
   11.2-d), the flag false. It refuses when the current `effects` equal neither array (drift). One
   audit row. It writes the arrays directly (owner only), because `cockpit_form_registry_set` refuses
   key changes (20261101l:1124). The version-2 arrays (`{key, delivery, owner, label}`):

   kickoff: `handoff_comment` clickup_queue cockpit "Handoff comment"; `native_status` clickup_queue
   cockpit "Task status In progress"; `card_fields` clickup_queue cockpit "Card fields"; `card_facts`
   clickup_queue cockpit "Empty card fields filled from the kickoff" (`20261102p`);
   `onboarding_tasks` sql cockpit "Tech and creative onboarding tasks"; `map_phase4` clickup_queue
   cockpit "Map phase 4"; `phase4_whatsapp` client_message cockpit "Phase 4 WhatsApp";
   `kickoff_notice` slack_notice cockpit "Kickoff notice"; `new_mrr` sql cockpit "New MRR";
   `recap` client_message **shadow** "Recap" (Q22: recaps stay off; never `cockpit`).

   onboarding: `profile_fields` clickup_queue cockpit "Client Profile and kickoff link"; `card_facts`
   clickup_queue cockpit "Company Website on the card, when empty" (`20261102p`);
   `raw_answers_comment` clickup_queue cockpit "Raw answers comment"; `map_phase3` clickup_queue
   cockpit "Map phase 3"; `github_dispatch` relay cockpit "Market intel dispatch"; `phase3_whatsapp`
   client_message cockpit "Phase 3 WhatsApp"; `brand_dna_task` sql cockpit "Brand DNA task";
   `read_model` sql cockpit "Answers in the client record".

   `20261102l` took `client_data_row` out of both onboarding arrays (version 1 too: Make's entry named
   a write Make never made; its [31] search writes nothing), so "off" restores 11.2-d's
   onboarding array without it (2.8, X34).

   `20261102p` added `card_facts` to both version-2 arrays (kickoff 10 effects, onboarding 8; version 1 unchanged), so
   the go-live writes `p`'s arrays and its drift check reads them. A registry row already on `l`'s version-2 array (a
   go-live before `p`) is moved to `p`'s by `p` itself, with one audit row `forms.stage4_card_facts` (2.10). At each
   go-live, read back that the registry `effects` equal `cockpit_form_stage4_effects(<form>, 2)` with `card_facts` in it.

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
   exactly as `stage4-native-supabase.test.ts` does, then `20261102o` when the file exists; fills what
   D-S4F fills (`onboarding.map_urls` and the option maps as live holds them, `stage4.messages` from the
   saved texts, `onboarding.raw_titles` from `stage4-raw-titles.json`, the `client_onboarding` and
   `brand_dna` request types through `cockpit_request_type_add`; the relay's settings are read from Make
   13 [25] in memory and never written); then calls `cockpit_form_parity_plan` on every stored answer and
   judges it against `make_parity.py`'s `oracle()` with the script's own `plan_lines()` and `summary()`.
   The kickoff runs twice: hidden values from Make 13 [29]'s link, and through the cockpit's own pipeline
   (`cockpit_form_stage4_hidden` on the card). Whether the request writer posts the task comment is
   `make_parity.py`'s own `onboarding_tasks` verdict (`TASK_COMMENT_STEP` and `REF_LINE`, 4.15.1); a last
   private line per kickoff, `onboarding_tasks_runner`, reads equal only when the branch's effects runner
   hands `comment_text` to the request and, in a rolled-back run that inserts the kickoff's response and calls
   `cockpit_request_create_system('client_onboarding', …)` exactly as the runner does, the request is made
   with 2 parts, each part's `taskComment` equals the handoff byte for byte, and no line of the handoff (20
   characters or more) appears anywhere else in a payload. Since round 3 a **native store pass** takes every
   stored onboarding answer, maps it to native keys and choice values through
   `cockpit_form_stage4_fields('onboarding')`, and runs it through `cockpit_form_answers_check` and then
   `cockpit_form_store_answer` on a real invite for the test card inside a rolled-back transaction
   (placeholders for blank required questions in older answers, never compared); `oracle.py native` reads
   `PASS` only when both keep every text byte for byte, nothing is refused for length and every store
   stores. Error lines carry the SQLSTATE and table, column or constraint names only. The source of the hidden
   values goes by date offline (no ClickUp read: Make 13 [29]'s link before 2026-10-22, the cockpit's link
   from then), so its fidelity line reads `not read offline` and is not counted. It prints ids, effect keys,
   run numbers and verdicts only;
   the answers stay in the private folder. The VPS run (D-S4F) stays the proof of record, because only it
   reads ClickUp for fidelity.

   Since round 4 (X39) the harness loads `20261102p` after `o` (`run.sh --without-p` leaves it out; `--without-o`
   drops both; the test's `beforeAll` applies both, so the harness cuts each left-out file's apply line from it, and
   until that fix on 2026-11-02 the flags changed only the `chain:` label; without `p` the contracts read `not run`),
   writes the request types' fields (`request-fields.json`) so `oracle.py compare` grades the brief slots
   with them, and takes the headers from `make_parity.py`'s `SLOTS` (`slots.json`), so they have one source. In the
   delivery step every part's payload must carry its registered brief whole (kickoff 2 parts, Brand DNA 1 part), and
   the brief is stripped by its exact text before the handoff-line check; a last private line per onboarding answer,
   `brand_dna_task_runner`, reads equal only when the brief reaches the Brand DNA task's description whole. `oracle.py
   additions` reports per run the brief's header (registered or not), kind and length, the `card_facts` fields
   planned (8-character ids, how many among the five, how many `onlyIfEmpty`), the dispatch keys and any unregistered
   effect; counts, ids and names only. A contracts pass checks that every planned `card_facts` passes the writer's
   own plan check, that every `openItems` item is one `cockpit-notices` names, that no new text (briefs and
   `card_facts` values) holds a contact answer, and that the portal's version-2 copy and its phone, link and revenue
   rules give the database's result. The native store sends number questions as JSON numbers and compares them as
   numbers, and expects links with `https://` and phones as E.164. Round 4's official run is in 11.10.

### 4.16 Better data on top of Make (X39; round 4, the better-data plan B1 to B8)

The CEO, 2026-11-02, after "Yes, match Make": "You can even improve what's already there with the data that you
have. So you can add more if it gives us better data." Rounds 1 to 3 proved the native outputs equal Make's on the 12
real stored answers; that output is now the **floor**, and every addition sits on top of it.

**Rules every addition keeps.**
- Make's own output is not touched: the handoff comment (card and both onboarding tasks), the raw answers comment, the
  Client Profile, the nine dropdowns, the map fields and the dispatch's two keys. Make-mirroring comments carry Make's
  text alone, and the Client Profile is never cut (X38).
- Additions go only into a slot Make leaves empty (a task description), an effect of their own (`card_facts`) or a
  cockpit-only surface (the Slack notice, the kickoff rail, the CSM brief, the comment digest).
- Missing is never zero. A missing answer leaves its line out and is named on one closing line, `Not in the forms:
  …`; a missing card link reads `not on the card yet`. No invented link, no 0 for a blank.
- No full name, personal phone or email goes into anything new. The front-desk phone (a business number) is the only
  phone added, and only on the onboarding tasks' brief.
- Every new card write goes through `clickup-writeback` with an audit row, writes only into an empty field and never
  overwrites.

| Item | Where it lands | Data source | Readers | When a value is missing | Parity slot |
|---|---|---|---|---|---|
| **B1** the onboarding tasks' brief | `onboarding_tasks.plan.details` (`detailsKind 'brief'`) → each task's description under the request's heading (Technical Onboarding Check `t-86ex8x9xw`, list `901816723190`; Creative Onboarding `t-86eyu1w3d`, list `901818016338`); the handoff stays the comment | at plan time: the card's stored onboarding answer (`cockpit_client_onboarding.forms->onboarding->answers`), the kickoff's own answers by ref, `cockpit_client_onboarding.links`, `cockpit_csm_calls` (kind `onboarding`, source `fathom`, same card, started in the 3 days up to the kickoff) | the tech team (Calendars, Call Center, Custom Values) and the creative team on the two tasks | the line is left out and named on `Not in the forms: …`; a card link reads `not on the card yet` (Market Research doc: `not ready yet; the market intel job adds it to the card`); the recording line is left out when neither the kickoff nor the call store has one; with no stored onboarding answer one sentence says so and only the links and the kickoff's lines follow; with no setup question answered, `- The kickoff left its setup questions unanswered.` | `intended: brief` (header `From the onboarding and kickoff forms (cockpit)`, ≤ 3,600) |
| **B2** the Brand DNA task's brief | `brand_dna_task.plan.details` (`detailsKind 'dna_brief'`) → the task's description (list `901818016338`) | the onboarding answer's own answers, `cockpit_client_onboarding.links`, the card's name | the creative team writing the Brand DNA doc | as B1; `Typed in the onboarding form as: …` shows only when the typed business name is not the card's (normalised, neither containing the other) | `intended: dna_brief` (header `For the Brand DNA doc (cockpit)`, ≤ 3,600) |
| **B3** Typeform's typed inputs on the native onboarding | onboarding version 2 in place (`o` round 4, 2.9, 3.6) and the portal (`forms-s4-portal`) | the client's own typing | Make's texts (Client Profile, raw answers comment, the kickoff link's values and so the handoff), the CSM brief | unchanged: a revenue of 0 prints blank, as Make prints it; required flags and wording unchanged (CEO-3) | none: it is Make's part, graded byte for byte (the native store pass) |
| **B4** the kickoff notice's open items | `cockpit_slack_notice_kickoff_facts` adds `openItems`; `cockpit-notices` `text.ts` prints one line after the handoff line in both `complete` and `late` | the stored kickoff answers by ref (`p_forms->kickoff->answers`), the form's own option labels | #csm-general (the creative director, the CSMs) | no stored kickoff answers, or none of the eight setup questions answered: no key, no line; every answered item done: `Nothing open from the kickoff's setup questions.`; an item that is not a fixed phrase is counted, never quoted (`<n> more, see the kickoff in the cockpit`); at most 8 named | inside `intended: notice` (Make posts no notice) |
| **B5** the kickoff rail: the card's Drive folder and "Check with the client" | `apps/client-success-cockpit/src/forms/formRail.ts` (kickoff rail) and `FormPanel.tsx` (`CheckPart`); the kickoff window's side panel and the kickoff deck's notes | the onboarding answers and the card (`links.drive_folder`, else `links.drive`; the card's name) | the CSM on the kickoff call | a blank answer is never a flag (except booking software, where "none given" is the point); no card link: their own non-Drive link reads `Their link`; never a made-up link; the part shows only when a flag holds | none: display only, nothing stored, prefilled or sent differently |
| **B6** the CSM brief's currency on the revenue goals | `apps/client-success-cockpit/src/lib/clientBrief.ts` `goalCurrency` | after the call summaries and the other answers: the billing country when the brief's input carries it (no caller passes it today), else the onboarding Phone answer's dialling code (+966 SAR, +965 KWD, +971 AED, +974 QAR, +973 BHD, +968 OMR); only the code is shown | the CSM brief | `(currency not stated)`; the text says `assumed`: `(SAR, from their +966 phone, assumed)` | none: display only; the Client Profile keeps Make's bare numbers |
| **B7** the whole kickoff comment in the digest | `supabase/functions/comment-watch/watch.ts` `digestPrompt` | the card comment of kind `kickoff` (a Kickoff Handoff or the raw answers comment) | the comment digest (the card's Do's & Don'ts) | unchanged; kind `kickoff` is cut at 16,000 characters (`DIGEST_KICKOFF_TEXT_MAX`), every other kind at 12,000 | none: cockpit only |
| **B8** `card_facts` | a new effect on both forms, after `card_fields` / `profile_fields`, written by `clickup-writeback` (4.13.4) | kickoff: Consultation Types from the appointment types (`c0000001-…-0008`: In-office → In Office, In-home or onsite → In Home / On Site, Online → Online; every ticked type must map, in ticked order); ADs Platform from `7d16afbb` (meta, facebook or instagram → Facebook/Meta; tik tok → Tiktok; snap → Snapchat; only when exactly one matches); Fathom from `b5578678` when it is a fathom.video link, else the call store's recording; Onboarding Call Date from the call store's day, else the kickoff's submitted day (Kuwait). A call store row counts only when an exact sign or a person placed it on the card (A7.14 rule 2; `cockpit_form_stage4_onboarding_call`, 2.10). Onboarding: Company Website from `454a425f` | ADs Platform: `csmProfiles`, `csmProfileCalculations`; Onboarding Call Date: `csmCadence`, `csmSync`, `onboardingCore`; Fathom and Website: `onboardingCore`; Consultation Types: `creativeProducer` | a field with no usable answer is not planned and its line says why; with no field the effect is skipped with a sentence and never queued; a set card field is kept (noted when it differs); no submit time, no date | `intended: card_facts` |

**Fields deliberately never written:** Country `e0ca65e7` (billing-sync reads it into billing; a phone-code guess must
not become a finance fact), ADs Platforms `8db2aa82` (no code reader), and City, Ad Account - Meta, Language and
Time Zone (no card reader). Daily Budget `539743c2` was here until CEO-5 was decided: since `20261103f` (4.21) a
kickoff fills it only while it is empty, in dollars, from the kickoff's own budget. Option ids come from the s40 snapshot; the forms doctor
checks them live once a Stage 4 form is in `CLICKUP_WRITEBACK_FORMS_KEYS`, and a changed option fails its row with no
write. Filling an empty Onboarding Call Date changes `csmCadence`: the CSM lead is told before D-S4K (11.10).

**The request route is intended too** (`request_route`, X39): the template's text and the `Cockpit ref` marker in
each task's description, the due date, priority, owners by rule, the client tag, the Request Type field and the card's
link comment, which 11.9 listed as cannot-match. The marker still keeps a task from being made twice (X38).

**Layouts.** B1 opens with the header, then `Read from the cockpit on <YYYY-MM-DD> (Kuwait). Answers are as typed.`
and where the whole answer is, then the groups `Links` (cockpit client page, the card's Drive folder, GHL, Brand DNA
doc, Offer Cheat Sheet, Market Research doc, call recording), `Still open from the kickoff` (B4's items),
`For the tech setup (Calendars, Call Center, Custom Values)` (appointment types `(confirmed at kickoff)` or `(from the
onboarding)`; appointment length and buffer; hours; consultants; furthest they travel, only when the types include
onsite or in-home; landmark; free consultations; front desk phone; payment options; Meta Business Manager, with `(needs
the access link)` for the unsure answers; booking software, with `(no system to connect)` when none-like; service
areas; services and prices cut at 500), `For creative` (services advertised in ticked order, with the note that the
card shows only the first; #1 service; years in business; projects completed; a fixed link-check sentence per flag),
and `Not in the forms: …`. Each value is cut at 400 characters (`…`). B2 opens with its header and the typed name line,
then `Links` (Brand DNA doc, Offer Cheat Sheet, Drive folder, Blueprint prep, cockpit client page, Market Research doc,
and the website, Instagram and Facebook answers each with its check), `Business Overview`, `Business Model`, `Market
Positioning`, `Target Audience` (ideal project, cut at 600), `Why they joined` (cut at 600) and `Not in the forms: …`;
services and FAQs stay out. Each brief is 3,600 characters at most (under the 4,000 a request's details take); the drop
orders are in 2.10.

**Sizes** (counts only). On the stored read model (the private run of `p`'s SQL builder): B1 44 briefs, median 2,108, longest 3,367
characters, 0 over 3,600, 0 drops; B2 42 briefs, median 1,766, longest 2,805. All 8 kickoffs with answers have at least
one open item (funded card 4, Google Calendar 5, Facebook access 6, training 5, contract 4, WhatsApp CRM sync 3, Mahara
OS 3, lead file 2). Kickoff `card_facts` would plan Consultation Types 8, ADs Platform 5, Fathom 4 and the call date 8;
the onboarding's Company Website 39 of 42, before the writer's empty check. The official oracle run's figures are in
11.10.

**Dropped, and why** (the plan's own list, kept short): a per-part comment for the brief (it needs a new writer step;
kept as the fallback if the tech kit rewrites the description and drops the text under `---`); a cockpit block appended
to the Client Profile and any change inside Make's texts (round 3's rule is Make's text alone); a general facts
function (each item computes what it needs); csmProducer's ad-account fallback (N/A-like answers on 4 of 5); the CSM as
watcher on the tasks (two CSM sources disagree on 10 cards); card writes for Country, Time Zone, Language, City, Ad
Account - Meta and ADs Platforms (inferred values, or no reader). The market intel dispatch's extra keys, a Client
Profile backfill, the onboarding's hints and optional questions, a version 3, the kickoff daily budget, New Client Form
ties and open items as requests are the CEO's (section 10, CEO-1 to CEO-7).

### 4.17 The Client Profile backfill (CEO-2 decided: "Sure"; build B2, migration `20261103c`)

The CEO, 2026-11-02, to "Fill the Client Profile for cards still in onboarding, with Make's exact text, only where it
is empty, after a dry run" (CEO-2): **"Sure"**. Design `next-design/backfill.md`; plan build B2.

**Scope (read only, 2026-11-03; counts and ids only).** `cockpit_client_onboarding` holds 70 cards; 42 have a stored
onboarding answer and 31 of those an empty Client Profile (`7755485f`); 7 are in onboarding (`inOnboarding()`), 6 of
them with an answer, and **3** with an answer and an empty profile: `86exnk0v4`, `86ey3303x`, `86eyew6mt`, **all
GHOSTED** with no launch date and no kickoff (answers from May, June and July). The three clients actively onboarding
already have Make's profile. The 6 Active cards with an empty profile stay out unless the CEO says so (the function
refuses a card not in onboarding; adding them is a one-line change and a fresh review). **Stop gate before the first
write:** the CEO is asked "The three cards your 'Sure' covers are all GHOSTED (no launch date, no kickoff). The three clients actually onboarding now already have Make's Client Profile. Fill the three anyway? The 6 Active clients with an empty profile stay out unless you say so." The deploy goes on only after he answers yes to the three; otherwise nothing
further is done. The apply's actor records that re-confirmation (`CEO-2 approved 2026-11-02 (Sure); scope re-confirmed by the CEO on <YYYY-MM-DD>; D-PB`), not only the 2026-11-02
Sure. The RUNBOOK row "The Client Profile backfill", step (2), holds the same words.

**Why a key of its own.** `profile_fields` overwrites a set field, also writes the Kickoff Form Link, carries the
profile in its queue payload (which the queue audit copies into `cockpit_audit_log`) and is refused by the gate for a
Typeform answer. `card_facts` may write only its own allowlist (4.16), which `make_parity` guards.

**Migration `20261103c_stage4_profile_backfill.sql`** (applies twice; owner-run):

| Object | Shape and rule |
|---|---|
| Guards | The gate's md5 is `j`'s (`a683c23676194229cc175e4d47cb8b2b`, live) or this file's **`4ca44d25514e25806229a7e6d185673b`**, else `cockpit_form_effect_gate(text,text) changed since 20261102j; stop and re-read it.` (55000, a `(sig, live, after)` row `guard_check.py` reads). It stands on `o`'s `cockpit_form_stage4_profile_text` `6c652fb1…`, `cockpit_form_typeform_text` `4509bcd5…`, `cockpit_form_stage4_make_text` `b14bfda4…` and the claim `cockpit_clickup_writeback_claim_forms` `c79ffe4c…` (`20261029t`): a missing text body stops it with `Apply 20261102o before this file (… is missing).`, a changed one with `… changed since 20261102o (this file stands on it); stop and re-read it.` (`20261029t` for the claim) |
| `cockpit_form_effect_gate(text,text)` | `j`'s body byte for byte plus **exactly two keyed branches** after the canary branch: `p_delivery = 'clickup_queue'`, the effect `queued` or `unknown`, owner `cockpit`, and `(form_key, effect_key)` = `(onboarding, profile_backfill)` or `(new_client, sale_facts)` (B3 plans the second; the plan's 2.2 puts it here so the gate changes once). Such an effect passes on its own, whatever the registry and the native window say: the backfill's answer is an old Typeform one, and the New Client Form has no native window (`cockpit_form_native_since` is NULL). Every other case answers exactly as `j`'s (the PGlite test compares both gates on 704 cases). The switch is not here: a refusal settles the row (`claim_forms`); the switch is the writer's lane. ACL: the owner's only. |
| `cockpit_form_profile_backfill(p_mode text, p_cards text[], p_actor text)` | `SECURITY DEFINER`, empty search path, `cockpit_hours_require_service()` first; revoked from all four roles, EXECUTE to `service_role` only. The deploy session calls it as the owner with the service claim set in the same statement (RUNBOOK). Refusals (22023): `Say dry_run, apply or cancel.`; `Name the cards: 1 to 10 different ClickUp ids.` (none, more than 10, a duplicate, a NULL or an id outside `^[A-Za-z0-9_-]{1,40}$`); `Say who approved this.` (apply or cancel with no actor, or one over 200 characters). There is no "every eligible card" mode. |
| `dry_run` | Writes nothing (no row in any table, no audit). Per card: `{taskId, state, reason, responseId, sentOn (Kuwait day), chars, answered (of 7), sha256 (first 12 hex)}`; never the text; `state` is `would_queue` or `skip`. `chars` and `sha256` are NULL on a skipped card (missing is never zero). |
| `apply` | Per card, in order, the client record locked `FOR UPDATE` (two applies take turns), one transaction each: the effect `(response, 'onboarding', 'profile_backfill', '<response>:profile_backfill', 'cockpit', 'clickup_queue', plan, 'planned')`; the queue row `profile_backfill:<card>`, kind `form`, source `cockpit_form_effects`/effect id, `task_id` the card; the effect `queued` with `delivery_ref` the queue id and `receipt {queueId}`. An error in one card's writes skips that card with its sentence, and the others go on. Idempotent: a second apply says `Skipped: already queued once for this card.` (the queue's `dedupe_key` and the effect's `(response_id, effect_key)` are unique). |
| The plan (B1's contract) | `{taskId, fields: [{fieldId: '7755485f-74a8-496c-85d8-562588e77944', kind: 'text', label: 'Client Profile', value: <text>, onlyIfEmpty: true}], lines: ["Client Profile from the stored onboarding answer (N characters)", "Only where the card's Client Profile is empty"]}`. The text is `cockpit_form_stage4_profile_text` over the stored answers as Typeform hands them to Make (`cockpit_form_typeform_text`, a ref answered twice giving its last answer): Make 13 [29]'s seven labels, uncut. |
| The payload (B1's contract) | Exactly `{formKey: 'onboarding', effectKey: 'profile_backfill', effectId, responseId, taskId, valueChars, valueSha256}` (lowercase hex sha256 of the UTF-8 text). **The text is never in the payload** (the queue audit copies payloads); the writer reads it from the claimed plan and checks it against `valueSha256` and `PROFILE_LABELS` before any call. |
| `cancel` | A backfill row in `queued` or `retry` with no step `started` or `done` becomes `skipped`, error `Cancelled before it reached ClickUp, so nothing was written.`; the from-queue trigger settles its effect `skipped` with the same sentence. A row that started, is `sending` or `unknown` is left alone: `Not cancelled: a write may have reached the card. Let the writer finish, then read the card.` No row: `Nothing to cancel: no Client Profile backfill was queued for this card.`; an ended one: `Nothing to cancel: this write already ended (<state>).` A cancelled card is not queued again. |
| Audit | Every effect insert and state change (`cockpit_forms_audit`, action `forms.profile_backfill_queued`, then `forms.effect_settled`, never the plan) and every queue insert and state change (`cockpit_clickup_writeback_audit`, the payload with no text). `apply` and `cancel` add one row `forms.profile_backfill_apply` / `forms.profile_backfill_cancel`, actor `p_actor`, metadata `{cards, counts, rows: [{taskId, state, effectId, queueId}]}`: ids and counts only. |

**Skip reasons** (in this order; each `state: 'skip'`):

| Check | Sentence |
|---|---|
| a client record | `Skipped: this card is not in the client records.` |
| in onboarding | `Skipped: this client is not in onboarding.` |
| the mirror's Client Profile empty (trimmed) | `Skipped: the card already has a Client Profile.` |
| a stored onboarding answer (an array of at least 1) | `Skipped: no stored onboarding answer for this card.` |
| a Typeform answer (`form_id` `KFRCXPFx`) | `Skipped: this client answered the onboarding in the portal, so its own Client Profile step fills the card.` |
| exactly one `cockpit_form_responses` row, form `onboarding`, this card, `external_id` = the read model's `response_id`, `submitted` or `confirmed`, mode `live` | `Skipped: the stored answer is not in the forms records. Tell the tech lead.` |
| its `answers->'fields'` equal to the read model's answers | `Skipped: the stored answer and the client record disagree, so nothing was queued. Tell the tech lead.` |
| no `profile_backfill` effect on any of the card's responses and no queue row `profile_backfill:<card>` | `Skipped: already queued once for this card.` |
| no open `profile_fields` effect (planned, queued or unknown) on the card | `Skipped: the native onboarding is writing this card's Client Profile now.` |
| at least one of the seven profile answers (a revenue of 0 prints blank, as Make prints it) | `Skipped: the stored answer has none of the seven Client Profile answers, so there is nothing to write.` |
| the text has Make's seven labels (`PROFILE_LABELS`; a revenue answer holding a line break fails it) | `Skipped: the Client Profile built from this answer does not have Make's seven labels, so nothing was queued. Tell the tech lead.` |

The last two keep a row the writer would fail as a mismatch from ever being queued: a failed `clickup_queue` effect has
no requeue.

**The writer** (build B1, live from `origin/main` `482e0fc6`): the row's lane is `profile_backfill`, held (`Held:
profile_backfill card writes are not switched on.`) until `CLICKUP_WRITEBACK_FORMS_KEYS` lists it. `backfillStep`
checks exactly one field, that id, kind `text`, `onlyIfEmpty`, Make's seven labels and the sha256, then `writeFacts`
reads the card fresh, saves the receipt `{before: empty|set, state}`, writes only an empty field, reads it back
(trimmed) and keeps any value it finds: `kept: the card already has a value for Client Profile …`. Three ClickUp calls a
card at the forms pace, each in the provider ledger. A held row also holds back every later form row on its card, so
the lane opens just before the apply and closes after the last row settles.

**The text is Make's (two sources).** On the 11 cards whose profile Make wrote, the same function gives 10 byte-equal
texts; the 11th was edited by hand after Make (`backfill.md` 1.2). The PGlite test builds the text a second way (an
independent builder of the seven labels, Typeform's trim and Make's number print) and runs B1's own `formStep` on the
row the real claim hands out.

**The dry run expected on the three cards** (read only, 2026-11-03, with `o`'s bodies inlined because the read-only
role may not execute them; D-PB's dry run recomputes it with the live functions and must agree): 3 `would_queue`, 0
skipped.

| Card | answered | chars | sha256 (first 12) |
|---|---|---|---|
| `86exnk0v4` | 6 | 265 | `9553c5c35200` |
| `86ey3303x` | 7 | 283 | `3e413fc47bfd` |
| `86eyew6mt` | 6 | 577 | `1854c2482e00` |

Each card has exactly one onboarding response (`typeform_sync`, version 1, `live`, `submitted`) whose answers equal the
read model's, no effect, no form queue row and no open `profile_fields`; the three texts match Make's seven labels.

**Deploy (D-PB, section 9).** After B1 is live and, recommended, after D-S4K's canary, so the backfill is not the first
live `writeFacts` call; and after Supabase egress is back (the writer and onboarding-sync are Edge functions). Production
writes: the migration; 3 effects, 3 queue rows and their audit rows; `CLICKUP_WRITEBACK_FORMS_KEYS` `+profile_backfill`,
then removed; 3 Client Profile writes, each only where empty. The steps are the RUNBOOK row "The Client Profile backfill".

**Tests.** `apps/media-buyer-cockpit/scripts/stage4-profile-backfill-supabase.test.ts` (17): every body it stands on
equals its live md5, the tables' live CHECKs and triggers, the gate's text (`j`'s plus the block) and after md5, two
applies, both guards, grants (anon, authenticated, the service role on the gate and the owner without the claim
refused; the RUNBOOK's call works), every refusal, the dry run writing no row in any table and never the text, each
skip reason, apply under B1's contract with the claim and `formStep`, idempotence, one card's error not stopping the
next card in the same call, the RUNBOOK's stop gate and the actor that records the CEO's re-confirmation, the claim keeping a held row in every mode (and `j`'s gate settling it), the `sale_facts` pass, the 704-case
matrix against `j`'s gate, cancel, and audit rows holding no text or contact value. The `forms-registry`,
`forms-invites`, `stage4-native`, `forms-writeback`, `stage4-match-make` and `stage4-better-data` tests stay green
unchanged, and `test_make_parity.py` is unchanged (the builder never plans `profile_backfill`).

**Rollback.** Before a write: `cancel` the cards and take `profile_backfill` out of FORMS_KEYS. After a write: the
receipt names each card written, and each field was empty before, so undoing it is a person clearing the Client Profile
in ClickUp, only on the CEO's word. Code: the gate's saved `j` body (`before-cockpit_form_effect_gate.sql`); the function
is inert without rows. A `failed` row is final (no requeue for a `clickup_queue` effect); a second try needs the CEO's
word and a new dedupe key, which is not built.

### 4.18 Typeform's hints and optional questions on the native onboarding (B0, `20261103b`)

The CEO, 2026-11-02, on "Restore Typeform's hints and optional questions" (CEO-3): **"Yes"**. Version 2 asked
`KFRCXPFx`'s questions with their words but dropped what Typeform shows under them. `20261103b` puts it back, in place,
the way `o` changed version 2, and adds `KFRCXPFx`'s fifth Meta choice to the Stage 4 question list (finding F3).

1. **What changes in version 2** (and nothing else: the order, the 39 items, every other question and setting stay):

   | Key | Change | English | Arabic |
   |---|---|---|---|
   | `personalPhone` | hint | We send appointment confirmations and updates to this number. Write one number only. If more people should get them, tell us on the onboarding call. | على هالرقم نرسل تأكيد المواعيد والتحديثات. اكتبوا رقم واحد بس، وإذا تبون أحد ثاني يوصله، قولوا لنا بمكالمة الانطلاق. |
   | `facebookAds` | hint | If you have a Facebook business manager, give us access before the onboarding call: https://app.leadsie.com/connect/maharamedia/manage | إذا عندكم حساب أعمال على فيسبوك، عطونا صلاحية عليه قبل مكالمة الانطلاق من هالرابط: https://app.leadsie.com/connect/maharamedia/manage |
   | `facebookAds` | fifth choice `restricted` | My account is restricted | حسابي مقيّد |
   | `hours` | hint | For example: Sunday to Thursday, 9am to 5pm. | مثلاً: من الأحد لين الخميس، من ٩ الصبح لين ٥ العصر. |
   | `landmark` | hint, and optional | Only if clients visit your office. | بس إذا العملاء يزورونكم بالمكتب. |
   | `appointmentLength` | hint | For example: a 60-minute appointment with 15 minutes between appointments. | مثلاً: الموعد ٦٠ دقيقة، وبين كل موعد والثاني ١٥ دقيقة. |
   | `consultants` | hint | For each one: name, speciality, nationality and qualifications. | لكل واحد: الاسم، التخصص، الجنسية، والمؤهلات. |
   | `freeConsults` | hint | Companies that offer a free consultation often get better results and more projects. | الشركات اللي تقدم استشارة مجانية عادةً تحصّل نتايج أحسن ومشاريع أكثر. |
   | `challenges` | hint | Name a few we can help with right away. | اذكروا كم شي نقدر نساعدكم فيه سيده. |
   | `driveLink` | hint (replaces the one-line summary; one item per line) | What to put in it: / Team photos / Photos with homeowners and clients / Before and after photos of projects / Testimonial and reaction videos from past clients / Videos of you, your team and your work in action / Educational content about your services / Time-lapse or walkthrough videos of projects in progress / Your logo as a PDF | شنو تحطون فيه: / صور الفريق / صور مع أصحاب البيوت والعملاء / صور قبل وبعد للمشاريع / فيديوهات آراء العملاء السابقين وردة فعلهم / فيديوهات لكم ولفريقكم وانتو تشتغلون / محتوى تعليمي عن خدماتكم / فيديوهات تايم لابس أو جولات بمشاريع شغالة / الشعار كملف PDF |
   | `businessName` | label | Business Name (in English) | اسم الشركة (بالإنقليزي) |
   | `address`, `projectsDone` | optional | (no word changes) | |

   29 questions are required (32 before) and 10 have a hint (`maxDistance` keeps its own). The wording was drafted under
   `aziz-kuwaiti-voice` (plural address, no em dash and no guillemets, Arabic-Indic digits with no `٬`); every hint is
   within the 600 characters `cockpit_form_schema_check` allows, and none holds a word the client text rule refuses.
   The Typeform originals (the question descriptions and the Meta dropdown's choices, the fifth label included) are in
   D-S4.0's full backup of the `KFRCXPFx` definition, `~/typeform-backups/KFRCXPFx-before-s40-20261102s40.json` (the
   D-S4.0 row in 9; the saved file `MAKE_PARITY_SAVED_DIR` points at), outside the repository. The file of that name
   in `scripts/dev/fixtures/make-parity` is trimmed to what the parity evaluator reads (4.15): it holds no description
   and no Meta choice, so it cannot show the originals. The English hours example now says the Gulf week, as
   Typeform's Arabic did.
2. **The window.** The file changes version 2 only from `o`'s text (md5 `bc89ca36000ebf7943c6ec569cd1be73`) and only
   while no answer and no invite uses version 2 (read 2026-11-03: none of either). Otherwise it stops: "The onboarding
   form's version 2 is in use (N answers and invites), so it cannot change in place: stop, and put these hints in
   version 3." It builds the new definition from the stored one, key by key, and stops unless the result is exactly the
   drafted one: **md5 `38d371cd509ced4fef9b7cad6e09fb80`** (the same text the portal's copy carries, P1). A second apply
   changes nothing. The registry's copy (`cockpit_forms`) follows when the onboarding is already live on version 2. One
   audit row per changed row, action `forms.stage4_v2_hints` (`cockpit_forms_audit`).
3. **The fifth Meta choice in Make's texts.** `cockpit_form_stage4_fields('onboarding')` is `o`'s list with one more
   option on `facebookAds` (`ddf2767d`): `{"value":"restricted","typeform":"My Account is restricted | حسابي مقيّد"}`,
   `KFRCXPFx`'s own label. Drift guard: `o`'s body `2b874cb1ed7fcf92a3d7fd9ca00547c5` (live) or this file's
   **`eadfda57d24997ad958ec6c68a1f5703`**; B5's guard reads this after value. The kickoff's list is `o`'s, byte for byte.
   A native `restricted` answer now prints Typeform's label in the read model, the raw answers comment (Make 13 [47])
   and the onboarding tasks' brief (`p`, B1: the label, with no access-link note); a late `KFRCXPFx` delivery that
   chose it is stored as `restricted` by the Typeform door (X26) and mapped by the parity plan. Before, the door put it
   in `answer_meta.unmapped` and Make's texts lost the answer (0 of the 46 stored answers chose it).
4. **F1, the cockpit reader.** `apps/client-success-cockpit/src/forms/prefill.ts` `completedOnboarding()` read only a
   `KFRCXPFx` entry, so after D-S4O the kickoff panel and the kickoff rail would have said every portal client "has not
   filled the onboarding form". It now also reads the read model's `form_id 'native'` (`NATIVE_FORM_ID`), whose answers
   carry `KFRCXPFx`'s refs and titles. Shipped with `scripts/ship.sh client-success`.
5. **Order and production writes.** The CEO approves the wording in 1 (section 10, CEO-3), then: the migration
   (version 2 in place, `stage4_fields`, 1 audit row while the registry is on version 1), `scripts/ship.sh
   client-success` (F1), and the parity run on the VPS from the merge (7/7 kickoff, 5/5 onboarding, verdicts as before).
   **It must apply before D-S4O's first invite**; D-S4O waits for it. If that window closes first, the same wording
   rides version 3 (B8) with no other change. Read back: the version-2 md5 `38d371cd…`, the fields md5 `eadfda57…`, 36
   onboarding questions in the list with the fifth option, `cockpit_form_stage4_fields` still the owner's only.
6. **Tests.** `stage4-match-make-supabase.test.ts` (the md5s and guards, each refusal, the registry copy, a native and a
   Typeform answer with the fifth choice equal to `make_parity.py`'s evaluator, the door storing `restricted`),
   `stage4-native-supabase.test.ts` (the merged chain with the real audit trigger, go-live and portal: one audit row, the
   first invite stopping the file, a portal answer with the fifth choice and the three optional questions empty),
   `stage4-better-data-supabase.test.ts` (the brief's Meta line), `test_make_parity.py` (Make 13 prints the label; a run
   with it passes once the plan maps it and fails with `answers differs` while it does not), and the client-success
   `form-prefill` and `form-rail` tests (a native entry reads as a full record).

### 4.19 The sale tie: every New Client Form on its card (CEO-6 decided; build B3, migration `20261103g`)

The CEO, 2026-11-02, on CEO-6: **"Should already be synced, if not do it fully now."** It was not: 0 of 55 stored
sales sat on a card, and the two card fields the CSM screens read for go-live (`d4483463`) and handoff problems
(`e17a1c27`) were filled on 0 of 70 cards (design `next-design/sale-tie.md` section 1). B3 is the backend of "fully":
every stored and every new sale tied to its card by an exact phone or email (never a name), the tie mirrored on the
stored sale, the two fields filled only where empty on cards on the books, and the portal's business-name context
fixed. The screens (the rail's "From the sale", the OnboardingKit's chip, the "Sales not on a card" band, the CEO's
forms-health line) are build B7 against the reads below. Billing's money tie (`cockpit_billing_deal_assignments`, live
`c0930161…`) is read as a second source and **never changed**.

**Keys.** Phone first, then email, exact and unique only. One normaliser, `cockpit_sale_tie_norm(kind, value)`: a
`phone` (the sale's typed answer, the card's Phone Number) must carry its country code (`+` or `00`; spaces, dashes,
dots and brackets out); a `raw_phone` (the sale's raw-phone answer `f322053a`, typed without the `+`, and the client's
onboarding answer `64f2fb80`) gets a `+` in front of 10 to 15 digits; the result must match `^\+[1-9][0-9]{7,14}$`, or
there is no key (a national number never is one). An email is `lower(btrim())` and must look like one; no folding of
dots or plus tags. Keys are kept **only as HMAC-SHA256 digests** (`hmac('<kind>:<key>', pepper)`, hex) under the vault
secret `cockpit_sale_tie_pepper`, made by the migration from 32 random bytes when absent and read only by owner
functions. A value travels into the database inside one service call and is digested at once; no table, audit row,
count, note, log line or answer holds a value or a digest outside `cockpit_sale_ties` and `cockpit_sale_tie_cards`.

| Side | Key | Source |
|---|---|---|
| Sale, on arrival | phone, email | the delivery's own typed `95a3901f` (phone_number) and `a6ea04df` (email), read by ref and type before the door's contact filter (`tieKeys`) |
| Sale, stored (backfill, and the sweep when the door opened no row) | phone | `f322053a` with a `+`, only when its last 8 digits equal `cockpit_sales_deals.phone8` |
| | email | `cockpit_sales_deals.email` |
| Card, K1 | phone, email | the card's own Phone Number `085d5e18-16f5-4cf5-8669-b8acf10700a5` and Email `a90c8230-fa67-4e41-b6ed-39306f061fc3` (Make writes both from the sale), and its ClickUp `date_created`, sent by the onboarding sync |
| Card, K2 | phone, email | the client's onboarding answer in `cockpit_client_onboarding.forms.onboarding` (`64f2fb80`, `7994f0d2`) |

**The match rule** (`cockpit_sale_tie_match`, every path). Candidates are cards on `cockpit_billing_accounts`, and a card
the onboarding sync keeps (`cockpit_client_onboarding`) that billing-sync has not listed yet (billing-sync runs
`7,37 3-18 * * *` and `17 21 * * *` UTC, so a card Make makes in the Kuwait evening would otherwise wait 2.5 to 6 hours;
read 2026-11-03: 70 onboarding cards, 68 on billing, the 2 others the playing account and an internal test), never the
playing account or an internal test (billing's own pattern, on the billing name, else the onboarding name), whose K1 or
K2 digest is the sale's. Make's card ties at the sweep that ends the sync run which first saw it.

1. One card by phone ties `phone`; `phone_email` when the email points at it too. The email on other cards only is a
   `conflict` (candidates: all of them).
2. Several cards share the key (a returning client; Make makes a card on every sale): the one card ClickUp made in
   [sale − 10 minutes, sale + 48 hours] ties, the others are kept in `also_on`. When the phone's cards are several and
   none is in the window, an email that resolves to one of them ties `phone_email`.
3. **While the sale is under 2 days old, a card made before that window never ties it**: the row waits for the card
   Make is making (decision B3-1 below). After 2 days the rules above apply to every candidate.
4. No phone key or no phone card: the same by email (`email`).
5. Still several cards: `ambiguous`. No card: `waiting` for 2 days, then `unmatched`. Voided in B2B: `void`.
6. A person's decision is never changed by the system. The door, the offer and the sweep check only `waiting` and
   `unmatched` system rows again; the backfill job also checks the system's own `ambiguous` and `conflict` rows and its
   own `tied` rows whose card notes are not planned yet (no `sale_facts` effect): it has every card's K1 and creation
   time, so a tie a sweep made from K2 alone moves to the in-window card, or becomes a `conflict` for a person when K1
   points elsewhere. A tie with a `sale_facts` effect stays as it is (`cockpit_sale_tie_apply` answers `kept`).

`key_source` says which card key matched: `card_fields` (K1), `onboarding_answer` (K2) or `both`. Each decision records
billing's card and method (`billing_task_id`, `billing_matched_by`); a disagreement never blocks an exact tie.

**Migration `20261103g_sale_tie.sql`** (applies twice; stops with `Apply 20261102o (Stage 4, match Make) and the billing
balances (20261023x) before 20261103g.` without them; drift guard on the three bodies it replaces):

| Object | Shape and rule |
|---|---|
| `cockpit_sale_ties` | append-only, one live row per sale (`UNIQUE (response_id) WHERE cleared_at IS NULL`): `response_id` (the Typeform token), `form_response_id`, `state` (`waiting`, `tied`, `ambiguous`, `conflict`, `unmatched`, `void`, `not_client`), `clickup_task_id` and `matched_by` (`phone`, `email`, `phone_email`, `person`) exactly when tied, `key_source`, `candidates[]`, `also_on[]`, `suggested_task_id`/`suggested_by` (`billing`, `sales_call`), `billing_task_id`/`billing_matched_by`, `phone_key`/`email_key` (digests), `note` (3 to 500, required for a person's tie and `not_client`), `set_by` (`system:forms-door`, `system:onboarding-sync`, `system:backfill` or a seat's address), `set_at`, `cleared_by/at/reason` (set once). Delete and truncate refused (`cockpit_hours_refuse_delete`); a lock trigger allows only setting `cleared_*` once. Its own audit trigger writes one row per insert and clear: ids, states and methods, the choice and role of a person's decision; never a digest, a note or a reason's text |
| `cockpit_sale_tie_cards` | K1 per card: `phone_key`, `email_key` (digests), `created_at` (ClickUp's), `seen_at`, `seen_by`. Written only by the offer and the backfill, changed rows only, one audit row per call (`forms.sale_tie_cards_seen`, counts). Delete and truncate refused. (Decision B3-2) |
| Grants | row security on both, no policy; every grant revoked from PUBLIC, anon, authenticated and service_role, then `SELECT` to service_role (the guardian); the sequence revoked |
| Pepper | vault secret `cockpit_sale_tie_pepper`, created once with an audit row `forms.sale_tie_pepper_created` (`{"bytes":32}`); never printed, never rotated by a file |
| Setting `forms.sale_tie` | `{"on": false, "fill": false, "salesLink": false}`, seeded with the merge rule of 2.1 (a second apply never turns a switch off); every change audited by the live `cockpit_settings_forms_audit` (`forms.switch_set`) |
| Registry | `new_client` keeps Make's four entries and gains `{"key":"sale_tie","label":"Sale tied to its card","owner":"cockpit","delivery":"sql"}` and `{"key":"sale_facts","label":"Go-live and handoff problems on the card, when empty","owner":"cockpit","delivery":"clickup_queue"}`, one audit row each (`forms.sale_tie_registry`) |
| `cockpit_form_responses_guard()` | replaced; live `d013e81456ebe7a8791270fe8858b972`, after **`f6caf2beba4c83801001f7e603844e62`**; owner only. One carve-out under `cockpit.forms_legacy = 'sale_tie'`: a `new_client` response in state `submitted`, answers unchanged, `answer_meta` changed only in `match` (`phone`, `email`, `phone_email`, `confirmed_by_person`) and `matched` (keys `by`, `at`, `via`, `taskId`, `from` only, `taskId` the card), `task_id` equal to its live tied row's card, or none (and no `match`/`matched`) when the live row is not tied. Every other refusal is as live |
| `portal_form_onboarding_open(text,text,text,text)` | replaced; live `81c9ede6f7c2c511d1e34c22388ddf24`, after **`fce6f339b02986b2d5cfcc09729a5def`**; service_role as live. The business-name context (4.14.1) is the card's newest live, tied sale's own answer `a1be4eee` (trimmed, 200 characters); nothing else changes. Before, it read `answers->>'businessName'` on a sale with a card, which no stored sale has |
| `cockpit_form_doors()` | replaced; live `709af1bfae87a41adaa5edf46ca5f0a9`, after **`2f0ada3d4b667de7d9d7139677960bdf`**; authenticated as live. Adds `saleTie` (list, decide and read exist, and `on`), `saleFacts` (`fill`) and `salesLink` (`salesLink`), each with its `why` (`missing`, `off` or null), as the waves 5-6 doors |

**Functions.** Owner only unless said: `_flags`, `_norm`, `_digest`, `_pepper`, `_key`, `_answer`, `_ts`,
`_stored_keys`, `_card_keys`, `_resolve`, `_match`, `_billing`, `_suggest`, `_evaluate`, `_card_name`, `_write` (clears
and inserts, then mirrors the response under the carve-out: `task_id`, `client_name` from the billing sheet,
`answer_meta.match` and `matched {by, at, via:'sale_tie', taskId, from?}`), `_apply`, `_plan_facts`, `_plan_pending`,
`_store_cards`. Service role (each also checks `cockpit_hours_require_service` inside):

| Function | Who calls it | Contract |
|---|---|---|
| `cockpit_sale_tie_open(p jsonb)` | forms-door, after `cockpit_form_record_make` (inserted or repeat) | `p = {externalId, submittedAt, tieKeys: {phone, email}}` (each text or null). A sale with a live row answers `{ok, state, tieId, repeat: true}` and changes nothing. Else one row: `waiting` with the two digests while `on` is off; the match rule while on (a tie plans its card fields when `fill` is on). Sets `detail.tie = 'ok'` on `forms-door:new_client`. Refusals: `That is not a Typeform response token.`, `Send tieKeys as {phone, email}, each text or null.` |
| `cockpit_sale_tie_door_failed()` | forms-door, when the call above failed | `detail.tie = 'failed'`, `tieAt` on `forms-door:new_client` (the guardian's reading) |
| `cockpit_sale_tie_waiting()` | onboarding-sync, start of each run | `{on, waiting, since}`: live `waiting` rows and the oldest one's signing time |
| `cockpit_sale_tie_offer(p_run bigint, p_cards jsonb)` | onboarding-sync, per card page while sales wait | `p_cards = [{taskId, createdAt, phone, email}]`, at most 200. Off: `{on: false, offered, stored: 0, tied: 0, waiting}` and no write. On: stores K1 digests and creation times, checks the waiting and unmatched system rows, plans the fields of new ties (fill on), answers `{on, offered, stored, tied, waiting}` |
| `cockpit_sale_tie_sweep(p_run bigint DEFAULT NULL)` | onboarding-sync, end of each run | Off: `{on: false}`. On: a row for every stored live sale without one (keys from the stored sources), the waiting and unmatched system rows checked again (waiting over 2 days becomes `unmatched`), every tie without a `sale_facts` effect planned while `fill` is on (newest sale first), and the health row `cockpit_sync_state` `sale-ties` (`ok`, a counts sentence, `detail {opened, tied, planned, waiting, unmatched, forPerson, run}`; while `fill` is on and the gate has no `(new_client, sale_facts)` branch, the sentence ends "Card notes wait for the forms gate that passes them (20261103c), so none were planned."). Answers the same counts |
| `cockpit_sale_tie_backfill(p_cards jsonb, p_dry boolean)` | the onboarding-sync job `{"job":"saleTies","dryRun":true|false}` | every card's K1 (at most 2,000). A dry run writes nothing. A real run needs `on` (`Sale ties are off. Read the dry run first, then turn forms.sale_tie.on on and run the job again.`), stores the card keys, writes each changed system decision (every system row but `void`, `not_client` and a tie with a `sale_facts` effect: rule 6), plans the fields while `fill` is on. Counts only: `sales, tied, phone, email, phoneEmail, person, cardFields, onboardingAnswer, both, waiting, ambiguous, conflict, unmatched, void, notClient, billingAgree, billingDisagree, billingOnly, salesCallAgree, salesCallDisagree, fillCards, fillOnBooks, fillInOnboarding, fillGone, cards, cardsWithPhone, cardsWithEmail, billingRead, dryRun, written, planned` (where every sale stands after the run) |

**The cockpit's reads and the one write** (authenticated, `SECURITY DEFINER`, the gate first; B7 builds to these, and
reads PGRST202 as "opens after the next cockpit update"):

- `cockpit_sale_tie_list()` → `{on, fill, salesLink, rows, summary}`. CEO or CSM seat (`cockpit_has_role('csm')`, so an
  admin too), else 42501 `Only a client success seat or the CEO sees the sales not on a card.` `rows`: each live
  `ambiguous`, `conflict` or `unmatched` sale, each `waiting` sale signed over 2 hours ago, and for the CEO only each tie
  billing puts on another card: `{responseId (the token), state, sentence, businessName, signedAt, signedOn (Kuwait
  day), closer (the sale's "Who closed" answer, else the hidden closer), tiedTo {taskId, clientName, tiedBy} | null,
  candidates [{taskId, clientName, reason}], suggestion {taskId, clientName, by?, reason} | null}`. Sentences: waiting
  "No card has this sale's phone or email yet. The next sync looks again."; unmatched "No card has this sale's phone or
  email after 2 days. Check Make 10's run, or pick the card."; ambiguous "More than one card has this sale's phone or
  email. Pick the right card."; conflict "The phone points to one card and the email to another. Pick the right
  card."; billing "Billing ties this sale to another card." Reasons: "Same phone as the card", "Same email as the
  card", "Same phone and email as the card", "Billing ties this sale to this card by its payments" (ledger), "... by its
  name" (name, alias), "The CEO linked this sale to this card in billing" (link), "Same sales-call link as the card".
  A CSM sees a row only when a candidate or the suggestion is one of their clients (`cockpit_client_allowed`), and only
  those cards. `summary` (counts only): `sales, onCard, byPhone, byEmail, byPhoneAndEmail, byPerson, forPerson, waiting,
  void, notClient, rows`; the CEO's line is "<sales> sales: <onCard> on their card (<byPhone + byPhoneAndEmail> by
  phone, <byEmail> by email, <byPerson> by a person), <forPerson> waiting for a person." and, before the migration,
  "Sales are not tied yet." Never a phone, an email or a digest.
- `cockpit_sale_tie_decide(p_response_id text, p_choice text, p_task text, p_note text)` → `{ok, responseId, state,
  taskId, clientName, facts, movedFrom?, handFill?}`. `yes` ties to the suggestion (billing's card, else the one sales-call card),
  else the one candidate; `pick` ties to `p_task` (on the billing sheet, never the playing account or a test);
  `not_client` (a test or duplicate sale) and `clear` (take a tie off; the row becomes `unmatched` with the old card as
  its candidate) need a note of 3 to 500 characters. The CEO decides any row; a CSM only for cards of their own
  clients, never moves or clears a tie whose `sale_facts` is `queued`, `unknown` or `delivered` ("This sale's go-live
  and handoff notes are already on another card. Ask the CEO to move it."), and marks `not_client` only a sale that
  shows one of their clients. The CEO's move, clear or `not_client` of a tie whose write has not started (effect
  `queued`, queue row `queued` or `retry`, no step started or done) **takes that write back** in the same transaction
  (`cockpit_sale_tie_take_back`): the queue row ends `skipped` "The CEO took this sale off this card before its notes
  were written, so nothing was written.", the live settle trigger skips the effect, the gate answers "This write was
  settled in the cockpit, so nothing was written.", and the audit row names that card as `factsTakenBack`. While the
  write is in flight (queue row `sending`, effect `unknown`, or a step started) the CEO is refused (55000) "This sale's
  go-live and handoff notes are being written to its card now. Try again once that write finishes." A written
  (`delivered`) tie may be moved; its audit row names the first card (`factsOnCard`) for a hand clear. One `sale_facts`
  effect per sale (unique on response and key), so the new card gets no cockpit write: the answer carries
  `handFill {taskId, sentence}` ("This sale's notes were planned for another card first, and the cockpit writes them
  once. Fill Go-live expectation and Handoff problems on this card by hand if they are empty.") when the new card is
  on the books and the sale has a go-live or handoff text. Needs `on` ("Sale ties are off. They open once the CEO
  turns them on."). Other
  refusals, plain: `Only a client success seat or the CEO ties a sale to a card.` (42501), `<client> is not one of your
  clients. Ask its CSM or the CEO to tie this sale.` (42501), `This sale has no suggested card. Pick one from the list.`,
  `That card is not on the billing sheet. Pick another.`, `This sale is already on that card.`, `This sale is not on a
  card.`, `Say why in a note of 3 to 500 characters.`, `The cockpit does not store a sale with that ID.` Toasts (B7):
  "Tied to <card>", "Marked not a client card".
- `cockpit_csm_sale_read(p_task_ids text[])` → `{on, cards: [{taskId, state: 'none'} | {taskId, state: 'tied',
  responseId, signedAt, signedOn, tiedBy, closer, goLive, handoffProblems, expectations, salesCallLink (https only),
  voidedInB2B, otherSales}]}`, gated like `cockpit_csm_onboarding_read` (`cockpit_csm_actor`, then
  `cockpit_csm_client_gate` per card, at most 200). The newest live tie per card; the texts as typed
  (`cockpit_form_typeform_text`). Never the raw phone, a name, a money answer or the transcript.

**Card fields (2.8, the writer is build B1's, live).** With `fill` on, the newest live tie on a card on the books
(`cockpit_billing_card_listed(task, true)`) plans one `cockpit_form_effects` row `new_client`/`sale_facts` (owner
cockpit, delivery `clickup_queue`) and its queue row, exactly B1's contract: the plan `{taskId, tieId, fields:
[{fieldId, kind, label, value, onlyIfEmpty: true, source}], lines}` holds the texts (Go-live expectation `d4483463`
from `e30bc458` and Handoff problems `e17a1c27` from `3cf4bfdf`, as typed, "No" written as typed, no cut; the Sales
Meeting Link `1f2e9ad1` from `52ca9be9`, `url`, https only, **only while `salesLink` is on**); the queue payload is
exactly `{formKey: 'new_client', effectKey: 'sale_facts', effectId, responseId, taskId}`, never a text. A gone card plans
a skipped effect "The client has left: no card fields to fill."; an older sale on the card "A newer sale on this card
fills its fields."; a sale with both answers empty "The sale left go-live and handoff problems empty, so there is nothing
to write." While `fill` is off nothing is planned ("Card writes for sales are off."), so turning it on plans every tie
at the next sweep (decision B3-3). Never the Closer `63af118b`, Closer Notes `890d4ab8`, Daily Budget `539743c2`,
Country `e0ca65e7`, Email, Phone Number or a billing field. Two waits spend nothing (no effect, the next sweep tries
again): a card billing-sync has not listed yet ("This card is not on the billing sheet yet, so its notes wait for the
next sync after billing lists it."), and **a gate without build B2's `(new_client, sale_facts)` branch**
(`cockpit_sale_tie_gate_ready()` reads `cockpit_form_effect_gate`'s body for `'sale_facts'`; "Card notes wait for the
forms gate that passes them (20261103c), so none were planned."). Today's gate (20261102j) does not hold such a row:
the claim's first pass (`cockpit_clickup_writeback_claim_forms`, live 20261029t) asks the gate of every open form row in
every mode and settles a refused one `skipped` "Make owns this again.", which would spend the sale's one effect slot.
With the branch, the writer holds every `new_client` row until `CLICKUP_WRITEBACK_FORMS_KEYS` lists `new_client`, and
**a held row holds back every later form row on its card** (20261029t), so `fill` goes on in the same step as the lane
(deploy step 6). B3 does not touch the gate. **Required of B2's branch** (defence in depth; this file already takes a
moved or switched-off write back): pass a `(new_client, sale_facts)` row only while `plan.tieId` is still the sale's
live `tied` row on `plan.taskId` and `cockpit_sale_tie_flags()` has `on` and `fill` true, else refuse with a plain
reason (the claim then settles it). The PGlite test holds the planned row against B1's own `formStep`, and runs the live
claim against 20261102j's gate plus B2's documented branch until 20261103c is on the branch.

**Taking a write back** (`cockpit_sale_tie_take_back(p_response uuid, p_reason text)`, owner only): each queue row of a
`queued` `sale_facts` effect that is `queued` or `retry` with no step started or done ends `skipped` with the reason;
the live `cockpit_form_effects_from_queue` trigger settles its effect `skipped` (a move the effects guard allows);
anything in flight is left and counted (`{takenBack, inFlight}`). Two callers: the CEO's decide above, and the trigger
`cockpit_sale_tie_switch_off` on `cockpit_settings` (`forms.sale_tie` updated without both `on` and `fill` true, or
deleted): "Card writes for sales were turned off, so nothing was written." Every queue and effect change is audited by
those tables' own triggers, the switch by `cockpit_settings_forms_audit`.

**forms-door** (`supabase/functions/forms-door/handler.ts`, README): `makeInput('new_client')` also returns `tieKeys`
(`tieKeysOf`: the typed `95a3901f` and `a6ea04df` answers only, by ref and type) and drops the raw phone `f322053a` by its
ref; the record gets `recordOf(makeInput(...))`, never the keys. After the record answers and its outcome is recorded,
the door calls `cockpit_sale_tie_open`; a failure calls `cockpit_sale_tie_door_failed` and never changes the 200. The log
line stays `forms-door new_client {outcome}`. The golden `fixtures/new-client-expected.json` holds `p` and `tieKeys`;
`scripts/dev/forms_legacy_backfill.py` ports both (`tie_keys_of`, `record_of`) and, after each stored sale, posts
`cockpit_sale_tie_open` too (a failure is counted, never printed: "sale ties not opened N (the onboarding sync's sweep
opens them)").

**onboarding-sync** (`supabase/functions/onboarding-sync/sync.ts`): `cockpit_sale_tie_waiting` at the start of a run;
while on and something waits, each page's cards made since a day before the oldest waiting sale go to
`cockpit_sale_tie_offer` (K1 from the two card fields, `createdAt` from `date_created`); `cockpit_sale_tie_sweep` at the
end. The run's counts gain `sale_ties_offered`, `sale_ties_tied`, `sale_ties_waiting` only while on and every call
answered (missing is never zero); a failure adds "Sales could not be matched to their cards this run. Ties already made
are unchanged; the next run tries again." to the run's problem and never fails the run; a function not there yet
(PGRST202) is "not set up", no note. The job `{"job":"saleTies","dryRun":true|false}` (dry unless `dryRun` is `false`)
reads every card once, refuses to match on a partial read, and answers `{ok, job, dryRun, counts, note}`; any other job is
400. The database's error text is never passed on.

**Guardian** (`hermes/cockpit-guardian/checks/sale_ties.py`, registered in `checks/__init__.py`, report-only): one check
`sale-ties` (owner the CEO): warn on a delivered sale with no tie row after 15 minutes, the door's `detail.tie =
'failed'`, and while on a sale waiting for its card over 2 hours or for a person over 3 days, and a B2B sale of the last
30 days the cockpit does not store (the second source); billing's disagreements are information. The door's mark warns
only while a delivered sale still has no tie row (the mark itself clears only at the next delivery, and sales are
rare, so a failure the sweep already fixed never warns for days). "Not set up yet"
before the migration, never zero; it reads ids, states and times only.

**Deploy (D-ST), in order** (the plan's step 9 and 12; B1 is live, B2's gate before step 6):

1. `guard_check.py supabase/migrations '20261103g*'` (3 rows, each live), then `mig.py dry` and `mig.py apply`. Read
   back: the pepper exists (count 1, no value read), the setting all false, the registry's six entries, the three md5s
   above, grants and row security, `cockpit_form_doors()` reading the three switches `off`.
2. `fdeploy.sh forms-door <rev>`, then `fdeploy.sh onboarding-sync <rev>`, each with its live `verify_jwt` (both `off`).
   With `on` false the door stores digests in waiting rows only.
3. `{"job":"saleTies","dryRun":true}` through the cron secret (counts only). Expected with K2 alone, read 2026-11-03
   (second source, the design's own figures reproduced read-only with this file's normaliser): 55 sales, 39 tied (33
   by phone, 21 of them by phone and email, 6 by email only), 0 conflicts, 0 ambiguous, 2 void, 14 with no card (13
   with billing's card as the one-tap suggestion, 1 with none). K1 can only raise the tied count; the dry run says K1
   coverage (`cardsWithPhone`, `cardsWithEmail`). The CEO reads the counts.
4. `update public.cockpit_settings set value = value || '{"on":true}', updated_by = '<who>' where key = 'forms.sale_tie'`
   (owner SQL, audited), then the job with `"dryRun":false` at once (a sync run in between opens the stored sales' rows
   from K2 alone, with no card creation times; the job then settles every system row, its tied rows included, with each
   card's K1 and creation time, because `fill` is still off and no tie has a `sale_facts` effect yet). Read back:
   `forms.sale_tied` audit rows, the stored sales' `task_id` on the tied ones, the counts again.
5. B7 ships (`scripts/ship.sh client-success`): the band, the rail, the kit, the forms-health line. The CEO or a CSM works
   "Sales not on a card".
6. In one step: `forms.sale_tie.fill` true (and `salesLink` true, CEO item 6 "do it fully" = yes), `new_client` added to
   `CLICKUP_WRITEBACK_FORMS_KEYS` with `CLICKUP_WRITEBACK_FORMS_ONLY_CARDS` set to one in-onboarding card the CEO names;
   the next sweep plans; read back both fields on that card and the effect's receipt; then remove the only-cards limit.
   About 19 cards × 2 (3 with the link) writes, only where empty.
7. The guardian release under its run lock.
8. Verify on production: the next real sale ties within one sync run; the rail shows the stub; the portal context
   returns the business name for an in-onboarding card. Record the session in mahara-context `shared/sessions/`.
9. Only on the CEO's word, after step 4: a one-time guarded strip of `f322053a` from the stored sales (owner SQL under
   the guard's own rules, an audit row, counts only). Not in this file (decision B3-4).

Rollback: `forms.sale_tie` all false stops ties and new plans at once, and its trigger takes back every card write
that has not started (queue row and effect `skipped`, "Card writes for sales were turned off, so nothing was
written."); a write already `sending` or `unknown` finishes, and the effects' trail shows where it landed. A
taken-back sale's one effect slot is spent, so turning `fill` on again does not re-plan it: its notes are a hand step.
Taking `new_client` out of `CLICKUP_WRITEBACK_FORMS_KEYS` is not the rollback (a held row blocks every later form row
on its card). The three bodies from `notes/forms-w56/deploy/before-<name>.sql`; ties are append-only (a person clears
one with a reason); fills are only-if-empty and every written card is in the effects' trail.

**Decisions this build takes (B3-n).**

- **B3-1, the window guard.** Design 2.3 rule 2 would tie a fresh sale of a returning client to the old card as soon as
  any sweep ran before Make's new card reached the sync. Under 2 days a card made before the sale's window never ties
  it; after 2 days the design's rules apply as written. A first sale ties at the first offer that carries Make's card.
- **B3-2, the card key store.** The door's "ties at once when a card with K1 is already known" and the window rule need
  K1 and creation times after the offer call, so `cockpit_sale_tie_cards` keeps them as digests (the same exposure as
  the sale's own digests), written only by the offer and the backfill with one audit row per call.
- **B3-3, fill off plans nothing.** The design's "Card writes for sales are off" skipped effect would have taken the
  effect's one slot per sale for good (an effect never goes back from skipped), so nothing is planned while `fill` is
  off and the sweep plans every tie once it is on.
- **B3-4, the raw phone.** The door stops storing `f322053a` from this build (its own rule). The 55 stored answers keep
  it until the CEO's word, because the backfill derives their phone digests from it (losing the pepper would need it).
- **B3-5, a CSM's limits.** Beyond design 2.7: a CSM may not move or clear a tie whose `sale_facts` is `queued` or
  `unknown` either (in flight), and marks `not_client` only a sale showing one of their clients.
- **B3-6, a write follows its tie or is taken back** (review fix-up, 2026-11-03). A queued write planned for a card the
  CEO has just rejected, or queued while `fill` goes off, would still reach that card (the gate and the writer check
  only that the queue, payload and plan agree). The CEO's decide and the switch's trigger take back every write that has
  not started; a move waits for a write in flight; the new card's notes are a hand step (`handFill`), because one effect
  per sale is the effects table's own rule.
- **B3-7, cards before billing lists them** (review fix-up). A card the onboarding sync keeps is a candidate before
  billing-sync lists it (playing account and internal tests excluded by name), so "tied within one sync run" holds
  overnight; its notes wait for billing's listing, since `cockpit_billing_card_listed` is the only "on the books" test.
- **B3-8, no plan before the gate can pass it** (review fix-up). Planning probes the live gate for B2's branch, so `fill`
  turned on early spends nothing; the sweep's note says why nothing was planned.

**Tests.** `apps/media-buyer-cockpit/scripts/sale-tie-supabase.test.ts` (PGlite, every case of design section 4: two
applies keeping a switch on, the prerequisite stop, each drift guard, the after md5s, the pepper once, row security and
grants, the normaliser and keys against node's own HMAC, the door off and on, phone, phone_email, the window and
`also_on`, the fresh-sale wait, ambiguous, conflict, waiting then unmatched then tied by K2, void, the playing account and
tests never candidates, the backfill job dry and real, who may decide and every refusal, a person's tie never changed by
the sweep or the backfill, append-only, the carve-out and every other guard refusal, an exit survey's match, fill off and
on, the newest sale only, a gone card, the payload exactly B1's and the plan passing B1's `formStep`, the Sales Meeting
Link only with its switch and on https, a card the onboarding sync keeps before billing lists it (tied at the sweep,
planned once billing lists it; an internal test never), nothing planned before B2's gate branch with the sweep saying
so, today's gate settling a row skipped in the claim's first pass (never a hold) and B2's passing it, a planned tie kept
by the job, the job settling a sweep's K2 tie with K1 (the in-window card, and a conflict), a CSM's move refused, the
CEO's move taking back an unstarted write (queue and effect skipped, the gate refusing, `handFill`), a move refused
while the write is sending or unknown and allowed once delivered with the first card in the trail, `fill` off taking
back every unstarted write so the live claim hands the writer no `sale_facts` row, the CSM read, the list with billing's disagreement
and the sales-call suggestion, the portal context from a stored-shape sale, the doors, and no value or digest in any audit
row or answer); `supabase/functions/forms-door/handler.test.ts`; `supabase/functions/onboarding-sync/sync.test.ts`;
`scripts/dev/test_forms_legacy_backfill.py`; `hermes/cockpit-guardian/tests/test_sale_ties.py`.

### 4.21 The kickoff's amounts and the ads chain (CEO-5 decided; B5 `20261103f`, B6 `20261103e`, writer B1)

The CEO, 2026-11-02, on the kickoff daily budget (CEO-5): **"Yes and sync it in the ass as well"**, read as "the ads"
(plan section 1, item 5; design `next-design/budget-ads.md`). The kickoff asks the daily budget as an **amount and a
currency** and the cold-lead close rate as a **number**; the figure joins the media buyers' agreed-budget chain; and the
client card's Daily Budget is filled in dollars **only while it is empty**. Nothing writes Meta, an Ads card outside a
launch a media buyer presses, a set Daily Budget, or GHL.

1. **The sheet's answer shape (what B7's FormSheet sends to `cockpit_kickoff_submit`).** Every other key is as before.

   | Key | Send | Refused (`errors[key]`) | Stored on the response | Printed (Make's texts, the read model's `answers[]`) |
   |---|---|---|---|---|
   | `dailyBudget` (`cf53482c`, optional) | `{"amount": <JSON number>, "currency": "USD"\|"SAR"\|"KWD"\|"AED"\|"QAR"\|"BHD"}`, or leave the key out. An object with no amount (`{"currency":"USD"}`, `amount` null or `""`) is no answer | `range`: the amount is 0 or less, over 100,000 or has 3 decimals; `option`: no currency or one outside the six (case matters); `format`: a string, a number, a list, an amount that is not a number, or any key besides `amount` and `currency` | `dailyBudget: "<amount> <CUR>"` (no thousands mark, no trailing zeros: `"40 USD"`, `"37.5 SAR"`) and `dailyBudgetParts: {amount, currency}` (internal: the sheet never sends it, `unknown` if it does) | `*Daily ad budget:* 150 SAR` (handoff line 71), `Not provided` when left out |
   | `coldCloseRate` (`079812c4`, optional) | a whole JSON number from 0 to 100, or leave the key out | `range`: anything else (101, 12.5, -1, `"20%"`, `"20"`) | `coldCloseRate: "20%"` | `*Current cold-lead close rate:* 20%` (line 102) |

   The question list (`cockpit_form_stage4_fields('kickoff')`) carries the rules the sheet draws: `dailyBudget`
   `{"type":"amount","currencies":["USD","SAR","KWD","AED","QAR","BHD"],"max":100000,"decimals":2}` and `coldCloseRate`
   `{"type":"percent","min":0,"max":100}`. Sentences for the refusals (B7's `kickoffRefused`, plain and active): range
   "Write an amount above 0 and up to 100,000, with 2 decimals at most."; option "Choose the currency: USD, SAR, KWD,
   AED, QAR or BHD."; format "Write the amount as a number and choose its currency."; the close rate "Write a whole
   number from 0 to 100." The live line under the amount uses the cockpit's fixed rates (`currency.ts` `USD_PER`, equal
   to `cockpit_board_usd_rate`; BHD has none: "No fixed rate for BHD yet, so the media buyers see the amount as
   typed.").

2. **Migration `20261103f_stage4_kickoff_amounts.sql`** (applies twice; writes no row; every function made or replaced is
   the owner's only, except the send and the Blueprint's sources, which keep their grant to `authenticated`). Drift guard,
   live md5 then this file's:

   | Function | Live (read 2026-11-03) | After | Change |
   |---|---|---|---|
   | `cockpit_form_stage4_fields(text)` | `eadfda57d24997ad958ec6c68a1f5703` (B0's) | `922d1d6f9b4b9f6a8c74ed131f888bb4` | the two kickoff questions above; every other byte B0's, the onboarding's list included |
   | `cockpit_kickoff_answers_check(jsonb)` | `8c3045bcdcf0906294d78d9ca7377a9b` (`o`'s) | `7f7c5ad2038431f1e3e2460d593c666a` | types `amount` and `percent` (1 above); every other answer `o`'s |
   | `cockpit_kickoff_submit(text,jsonb,uuid)` | `bc569e54e47b14ecf4c99d714fdb3e92` (`j`'s) | `1760ef776ce5e9497b3cff8ba1a79e14` | the read model's two side keys (3 below) |
   | `cockpit_form_stage4_card_facts(text,text,jsonb,timestamptz)` | `71dbdcbec818527002f08cdff97f36fa` (`p`'s) | `9535abd07330ccdc2ac3dd90da3147d2` | Daily Budget (4 below); every other field `p`'s |
   | `cockpit_blueprint_sources(text)` | `91de3df5b9c21c0f45472bc9dc1dd615` (`20261025o`'s) | `dfba8692570efc6e1d96cb31a9f4c09f` | `kit.budgetUsd`, `kit.budgetCurrency` (5 below) |

   New, owner only: `cockpit_kickoff_budget_of(numeric,text)` (the parts at the fixed rate), `cockpit_kickoff_budget_read(text)`
   (an answer text) and `cockpit_kickoff_budget(text)` (one card). **The window:** kickoff version 2 changes in place
   only while no kickoff was stored from the cockpit (any source but `typeform_webhook` and `typeform_sync`) outside the
   CEO's canary on the test card (`answer_meta.canary` true on `86eywg1cq`, plan 2.6) and `forms.stage4.kickoff` is off
   (read 2026-11-03: 0 and off). Otherwise: "The kickoff is live in the cockpit (N sent there outside the test card…),
   so its questions cannot change in place: stop, and ask the amount and the close rate in a kickoff version 3." A
   second apply (the list already this file's) is not stopped. The version row `cockpit_form_versions('kickoff', 2)`
   stays the staff marker `o` left it (the send checks answers against the question list only).

3. **The read model.** `forms.kickoff` gains, beside `payment` and `recording`, each only when answered:
   `budget: {amount, currency, usd, rate, said}` (`usd` = amount at the fixed rate, to the cent; `null` with no rate
   or when the dollars round below a cent (0.01 QAR, SAR or AED: `rate` kept, `usd` null), never 0;
   `said` = `"<amount> <CUR>"`) and `close_rate` (the number). The Typeform-shaped `answers[]` keep the texts,
   so `growth.js`, Pending payments, the Blueprint SQL, the briefs and the handoff read what they read today.
   **`cockpit_kickoff_budget(task)`** returns `{amount, currency, usd, rate, said, from_text}` or NULL: the side key
   first, converted at read time (a rate added later reaches it); else the answer text by `cockpit_kickoff_budget_read`:
   the kickoff's own `"<amount> <CUR>"` (`from_text` false), else a typed figure read as dollars by
   `blueprintPrefill.parseBudget`'s rule (Arabic-Indic digits read, a thousands comma dropped; none when the text names
   another currency or a range; the first number, from 1 to 100,000, to the cent; `from_text` true, `said` as typed).
   Read 2026-11-03: all 6 stored Typeform budget answers read as dollars (none names a currency or a range).

4. **`card_facts`, Daily Budget `539743c2`** (kickoff only, after Onboarding Call Date): `{fieldId, kind: "currency",
   label: "Daily Budget", value: <USD as a JSON number>, onlyIfEmpty: true, source: "kickoff" | "kickoff_text"}`, planned
   only from 1 to 100,000 dollars (B1's contract: a text, 0, over 100,000 or 3 decimals fails the row). Lines: "Daily
   Budget, if empty on the card: 39.99 USD a day, from 150 SAR at the cockpit's rate"; not planned: "…the cockpit has no
   fixed rate for BHD yet.", "…0.27 USD a day is outside 1 to 100,000 dollars.", "…0.01 QAR a day is less than a
   cent in dollars, outside 1 to 100,000 dollars.", "…the answer is not an amount the cockpit can read." The value is USD because the field is a USD currency field (the forms doctor checks
   `type_config.currency_type = 'USD'` live). `clickup-writeback` (B1, live) writes it only while the card leaves it empty:
   the sale's figure (Make 10 "Add Billing Info", 21 of 25 cards since July) is kept, `kept` with `differs` when it
   is another figure.

5. **The Blueprint.** `cockpit_blueprint_sources` adds `kit.budgetUsd` and `kit.budgetCurrency` (from
   `cockpit_kickoff_budget`; both null with no kickoff budget, `budgetUsd` null with no rate or below a cent, never 0) beside `kit.handover.daily_budget`.
   B7's `blueprintPrefill` prefers them ("From 150 SAR at the cockpit's rate: confirm it in dollars." when not USD), and
   `blueprintBrief` compares the confirmed dollars with `budgetUsd`, not with `firstNumber(said)`. The Blueprint still
   never writes Daily Budget (`cockpit-creative-api/blueprint.test.ts`).

6. **Parity.** `make_parity.py`: Daily Budget joins `CARD_FACTS` (`currency`) and leaves `CARD_FACTS_NEVER`; a planned
   Daily Budget is `intended: card_facts` only when its value is the run's own kickoff budget in dollars (the answer
   Make's trigger holds, read by `kickoff_budget_usd`, the port of `cockpit_kickoff_budget_read`) with that reading's
   source; anything else reads `card_facts plans Daily Budget other than as the kickoff's own budget in dollars`. A
   Typeform kickoff never passes through the new types (`cockpit_form_stage4_native_answers` and `_typeform_answers`
   keep its texts as they came), so every Make text stays byte for byte on the stored kickoffs; their `card_facts` may
   now plan Daily Budget from the typed figure (`kickoff_text`), graded as above.

7. **The ads half (B6, `20261103e`, live; `docs/media-launch/SPEC.md` 2.4).** One chain, newest agreed first, sets the
   launch desk's default and its 2x cap and the client page's "Agreed $40 a day (kickoff, 150 SAR). Set now: $25 a day."
   note: the Ads card's Daily Ad Spend, Blueprint part 1 as sent (`daily_budget.usd`, the object-shape bug fixed), the
   kickoff in dollars (`cockpit_launch_kickoff_budget`, which reads `cockpit_kickoff_budget(text)` once this file
   exists: labels `Kickoff, 150 SAR` or `Kickoff, as typed: $60`; BHD keeps its amount and is not the default), then the
   sale (relabelled "Sale (card Daily Budget)"); a figure under $2.50 or (Blueprint, kickoff, sale) $1,000 or more is
   listed but never the default. The desk writes the Ads card's Daily Ad Spend only at a switch-on a media buyer
   presses. **When `20261103f` applies, the chain starts reading the stored Typeform kickoff budgets** (read as typed
   dollars): on the cards where the kickoff is higher than the sale (4 of 5 checked), the desk's default and its 2x cap
   rise. The media lead hears this before the apply.

8. **Order and production writes.** After B0 (live) and B1 (live, Daily Budget in `CARD_FACTS`), with the CEO's reading
   of item 5 (decided by default 2026-11-03): `guard_check.py` on `20261103f*.sql` (5 live, 0 after), the dry run, then
   the migration; it lands **in the same window as B7's ship, migration first** (the sheet must send the new shape),
   both before kickoff go-live. Read back: the five after md5s; `select public.cockpit_kickoff_answers_check('{"dailyBudget":{"amount":150,"currency":"SAR"},"coldCloseRate":20,"newMrrUsd":0}')`
   gives `150 SAR` and `20%`; a count of cards whose `cockpit_kickoff_budget` is not null (counts only, no value
   printed); the parity run on the VPS from the merge (7/7 kickoff, 5/5 onboarding; `card_facts` may now name Daily
   Budget, still `intended`). Then the B5 canary: a CSM (or the CEO on the test card) sends one kickoff with the amount
   field, and the handoff's line 71 and the test card's Daily Budget (only if it was empty) are checked in ClickUp. Undo,
   only before go-live: the five saved bodies in one transaction and `drop function` the three new ones (B6's reader then
   falls back to the side key).

9. **Tests.** `stage4-kickoff-amounts-supabase.test.ts` (PGlite, 35): the guard (live and after md5s, a second apply, a
   changed body, the window: a send off the test card, the switch, the canary and the Typeform kickoffs); the question
   list; the check's cases (40 USD, 37.5 SAR, 0, 100001, three decimals, EUR, a plain string; 20, 101, 12.5; blanks;
   `dailyBudgetParts` refused; every other answer `o`'s); the send (`budget` with `usd` null for BHD, `close_rate`, no
   side key unanswered, `j`'s entry otherwise, the canary); handoff lines 71 and 102; 8 Typeform-shaped kickoffs equal
   through the parity plan's mapping; `cockpit_kickoff_budget` (side key, a rate added later, Typeform text, a range) and
   B6's reader on it; `card_facts` planned or not, `p`'s otherwise, the value taken by B1's `budgetAmount`; the
   Blueprint's two keys with `20261025o`'s gate and keys otherwise; the second source (the SQL dollars equal
   `currency.ts` `USD_PER` to the cent on 13 amounts in six currencies, `usdToBudget` gives the amount back within 2
   hundredths, the typed-text rule equals `parseBudget` on 25 texts); grants. `test_make_parity.py`: "plans Daily Budget
   only from a converted kickoff budget". `kickoff-sheet.test.tsx` reads the new list.

10. **Waits on people (section 10).** The media lead: the new order and the $1,000 guard, and whether the kickoff's
    budget is per campaign or for all ads (the hint's words depend on it). The CEO or the finance owner: BHD (2.6596) and
    OMR (2.6008) rates, or leave Bahrain budgets unconverted. A CSM: the B5 canary before go-live.

### 4.23 Market research, MI-1 (CEO-1 decided: replicate and improve; build MI-1, migration `20261103i`)

The CEO, 2026-11-02: "Find it in the context somewhere, find the market intel, or make it even better and replicate
and improve it with a better scraper." Found: the teammate's `market_intel_job.py` on a self-hosted runner. Replaced,
in stages, by `hermes/market-intel` (design `next-design/market-intel.md`, plan section 3 MI-1). **MI-1 is dark**:
the worker, the tables and the gated reads; nothing is published, and the old job keeps running until the cutover.

**What runs.** A VPS worker in the radar's discipline (keys by name from `~/.market-intel/env`, `doctor`, tests with
fakes and recorded shapes, cron every 2 minutes under `flock`, a weekly prune, a RUNBOOK section, one
`cockpit_sync_state` row `market-intel` per tick). Code does every pull (Apify, ScrapeCreators, direct website
reads, each call in `cockpit_csm_provider_health` with run key `market-intel:<run>`); Claude on the VPS picks 6 rivals
and 2 reserves from a code-scored shortlist of 25 and writes the findings, with no tools, from the evidence fenced as
data. Engine switch `MARKET_INTEL_MODEL_PROVIDER`: `vps` (default, the proxy on the CEO's sign-in) or `cli`
(`claude -p`, every tool off, a setup token). Numbers are filled by code from the evidence, with a second source for
the rating, review count and followers that ship.

**Migration `20261103i_market_intel.sql`** (replaces no live function; a drift guard on its own 22 bodies; applies
twice):

| Object | Shape and rule |
|---|---|
| `cockpit_market_intel_runs` | one row per run: reason (`onboarding`, `shadow`, `rerun`, `backfill`, `kickoff_refresh`), mode, state (`queued` to `publishing`, then `done`, `needs_person`, `failed`, `cancelled`), lease, attempts, `stage_progress` (ids and states only), cumulative spend (never goes down), counts, the sentence. One open run per card; one onboarding or shadow run per stored answer |
| `cockpit_market_intel_evidence` | `E1...` per run: kind, subject (`client`, `market`, `K<n>` candidate, `C<n>` rival), URL, time, source, cost, trimmed body, sha256. Inserted once (a resume never rewrites); a review naming its reviewer is refused; bodies pruned after 180 days |
| `cockpit_market_intel_findings` | per language: the findings and each rule's result |
| `cockpit_market_intel_competitors` | the picks, their numbers (NULL is "not checked"), the "Not a competitor" flag (kept across upserts) |
| Grants | row security on all four; nothing for anon or authenticated; `SELECT` only for `service_role`; every write through a function below, each with a `cockpit_audit_log` row |
| Worker functions (`service_role`) | `enqueue`, `scan` (answers since `shadow_since`, while on), `claim` (one at a time, 60-minute lease, a lapsed lease resumed first, three tries), `progress` (hands back `on` and the caps, so a run stops or tightens mid-run), `store`, `release` (back to the queue for N minutes; `p_kind` `error` is a try, `outage` and `paused` give the claim's try back, an outage's wait doubles to 4 hours and 24 hours of outages end the run `needs_person`), `done` (a shadow run cannot record a Doc, a field write or a comment), `input` and `preview` (never the five contact answers), `nap` (match, differs or not_checked; the number stays in the database), `month_usd`, `prune`, `settings`, `effect` |
| Cockpit functions (`authenticated`, gated inside) | `view` (CEO, admin, creative, media buyer, a CSM on their own clients through `cockpit_csm_client_gate`; the budget only for CEO and admin; findings only from a `done` run), `rerun` (CEO or admin, setting on, a reason of 10 to 300 characters, no open run, the month not spent), `flag_competitor` (CEO or admin). Reached through `cockpit-csm-api` operations `marketIntel.view`, `marketIntel.rerun`, `marketIntel.flag` (a verified sign-in first; the database's refusal is the cockpit's sentence; PGRST202 reads "Market research opens after the next cockpit update.") |
| Setting `market_intel` | `{on:false, mode:'shadow', apply_drive, apply_clickup, apply_kb: false, only_cards:[], usd_cap_run:2, usd_cap_month:25, refresh_on_kickoff:false, shadow_since:<apply time>}`, seeded once with an audit row; every later change audited by this file's own trigger `cockpit_market_intel_setting_audit` (`market_intel.setting_set`, value before and after; the live forms and billing trigger untouched) |
| Effect | `{"key":"market_intel","label":"Market research","owner":"cockpit","delivery":"sql"}` is catalogued (`cockpit_market_intel_effect()`) and is **not** in `cockpit_form_stage4_effects` or any registry row; the cutover migration adds it at D-S4O with the owner's agreement, and `make_parity.py` gets `INTENDED['market_intel']` then (after B8, plan 2.10) |

**The validator** (`mi/check.py`, before anything is stored as findings): 1 shape (13 sections, both editions);
2 every claim cites evidence this run pulled, every URL is an evidence URL; 3 no typed number (metric references
only; a duration in the 90-day plan is allowed); 4 Arabic and English carry the same claims; 5 at least 5 rivals with
2 independent sources each, 20 evidence items, the client's presence checked on 4 of 6 channels; 6 form answers only
as the client's claims with the form date, no mystery shop; 7 no phone, email or internal id; 8 the positioning and
plan sections are recommendations. One repair call; a second failure ends `needs_person` with the rule's sentence.

**Money.** Run cap USD 2.00 and month cap USD 25.00 (the lower of the setting and the worker's env), enforced before
every pull; Apify runs carry `maxItems` and `maxTotalChargeUsd`, and the meter holds each run's ceiling while it is
in flight, so runs side by side never add up past a cap; an aborted run's cost is read and counted; at most 40
actor runs a report. A typical run is
USD 0.50 to 0.75 of Apify plus about USD 0.05 of ScrapeCreators (design 2.4; measured in shadow).

**Outputs in MI-1.** The three tabs as text and as the Docs `batchUpdate` requests (UTF-16 indexes, the Arabic tab
right to left), the card field `7489dbcc` value and the one comment (marker `Cockpit ref MI-<8 hex>`, not notifying)
in `outputs.json` with `sent: false`. The Onboarding Answers tab leaves the contact answers out ("Contact details are
on the client card", Q4 pending).

**Guardian** (`checks/market_intel.py`, report-only): `mi-stuck` (fail: a lease lapsed over 10 minutes, or a run open
over 3 hours), `mi-missing` (warn, while on: an answer since `shadow_since` over 3 hours old with no `done` run),
`mi-spend` (warn over 80 percent of the month cap, fail at the cap).

**Deploy (MI-1 install, then MI-2):** the migration (dark); `cockpit-csm-api` with its live `verify_jwt`; the worker
on the VPS as the radar's user, env file mode 600, `doctor` green, the two cron lines (crontab backup first, the same
lines in the guardian's manifest); the guardian release. MI-2 (the CEO's yes): `market_intel.on` true in shadow, the 5
October clients through `backfill` (about USD 4), side by side with the current reports.

#### 4.23.1 The card writer, MI-1b (`clickup-writeback` job `research`; no migration of its own)

A published run's two card outputs, written as today's job writes them and through the writer's discipline: one
queue row each, kind `research`, read fresh, written exactly once, read back, a receipt on the row and an audit row for
every state change (the queue's own trigger). Files: `supabase/functions/clickup-writeback/research.ts` (switch, check,
writer, doctor checks), `run.ts` (`runResearch`, `runResearchDoctor`, the general doctor's line), `index.ts` (jobs
`research` and `research_doctor`, at the forms jobs' pace), tests `research.test.ts` and the shared golden
`fixtures/research-outputs.json`, which `hermes/market-intel/tests/test_writer_contract.py` checks against
`mi/render.py outputs()`.

| Row (`payload.effectKey`) | What is written | Rule |
|---|---|---|
| `research_field` | Market Research doc `7489dbcc` (a `url` field; `cockpit_clickup_fields` read 2026-11-03) = the run's `https://docs.google.com/document/d/<id>/edit` | Written only while the field is empty or holds a Doc of an **earlier** published run of this card (`plan.replaceable`). This run's Doc already there (any suffix) is delivered with no write. Any other value is kept: a person's link, today's job's Docs (7 of 70 cards, `.../edit?usp=drivesdk`), the old ClickUp docs (18): skipped with "kept: the card's Market Research doc already holds another link, so it stays." Read back by Doc id; another link arriving during the write is kept ("raced"). Receipt `progress.steps.research_field` = `{state, before: empty or ours or same or set, result: written or kept, raced?}`, never the link |
| `research_comment` | One comment, `notify_all: false`, the worker's text, last line `Cockpit ref MI-<first 8 hex of the run id>` | The card is searched for the marker before the first post (found: delivered, nothing posted); once ClickUp answered the post with an id it is never posted again ("check the card" if it is gone); found again by marker and id. Receipt `progress.steps.research_comment` = `{state, commentId}` |

**Checked before any call** (a mismatch fails the row with no call): the row's, payload's and plan's card are one
card; `payload.runId` is the claimed run's id; the run is `mode = 'live'` in `publishing` or `done`, or ended `failed`
or `needs_person` with this Doc kept (`run.docId` the payload's); a run back in progress (`queued` through `checking`:
`cockpit_market_intel_release` sends a run that already published back to `queued` after an error, an outage or a
pause) hands the row back with no try used ("Held: this research run is running again ..."), never fails it; a shadow
run, a cancelled one or one that ended without its Doc fails in words; `payload.docId` is the link's Doc id; the
link's and the comment's sha256 equal `payload.valueSha256` / `payload.commentSha256`; the comment links this run's Doc and ends with its marker, once;
`replaceable` is at most 20 Doc ids. Links at most 300 characters, comments at most 2,000.

**Switch** (Edge secrets, `researchGate`; no other switch opens it): `CLICKUP_WRITEBACK_APPLY_RESEARCH` exactly `true`;
`CLICKUP_WRITEBACK_RESEARCH_KEYS` the outputs written, `field` and/or `comment`; **unset means none**, so every row is
held (handed back, no try used) until MI-3 lists them; anything else in the list opens nothing and reads not ok;
`CLICKUP_WRITEBACK_RESEARCH_ONLY_CARDS` narrows to canary cards (`86eywg1cq` first), a value that is not card ids
opens nothing. Each run reports `cockpit_sync_state` `clickup-writeback:research` (`detail.mode`, `detail.keys`,
`detail.onlyCards`, `detail.at`, counts). The general `doctor` names the switch ("Market research writes: ..."), and
`research_doctor` reads only: the switch, the queue and the publish brake from the database, field `7489dbcc` on
Clients - Mahara as a `url` field, and the canary card (`clickup-writeback:research-doctor`).

**What the database must add (the MI-3 migration; MI-1b has no letter and applies nothing).** Until then the job
answers "Market research writes open with the MI-3 migration: the database has no research queue yet ... Nothing was
read or written." (not ok; never "Nothing to write"), and the doctor names the same gap.

1. `cockpit_clickup_writeback_queue_kind_check` and `cockpit_clickup_writeback_runs_job_check` gain `research` (each
   under its own definition guard, as `20261029t` did); `cockpit_clickup_writeback_begin` accepts job `research`;
   `cockpit_clickup_writeback_release` hands a `research` row back (queued, or retry once its steps hold anything);
   **the generic claim `cockpit_clickup_writeback_claim(uuid,integer)` never takes one**: `AND q.kind NOT IN
   ('request','task_action','form','research')`, the change `20261029t` made for `form` ("so the deployed log job never
   settles one skipped"). Without it the log job (pg_cron `mahara-clickup-writeback-log`, every 2 minutes) takes a due
   research row first, past this writer's switch and the research claim, finds no branch for it in `buildSteps` and
   settles it `skipped` ("A question or a request, not a change ..."), and it reclaims a research row left `sending`
   for 10 minutes, so the field and comment are never written. `cockpit_clickup_writeback_idle` accepts job `research`
   too (else index.ts's crash line for the job is dropped). Each replaced body under a drift guard on its live md5, read
   as `20261029t` reads it (`md5(regexp_replace(prosrc, '\s+', ' ', 'g'))`), live 2026-11-03 (read-only), all four
   `20261029t`'s: claim `2a3313b36fb6e0b4b86d1312ea922697` (its `md5(pg_get_functiondef(oid))` is
   `ad74062c01574dfd75540b2af2573449`), idle `08b5e5a296dfa7f00c0d6da422f4cd54`, begin
   `4d649b297933116a4bf1e5a954bf552a`, release `19526fc6726c6273b180cfedf527e1b7`; read them again before writing.
2. An enqueue, service role only, called by the worker once the run's Doc exists (state `publishing`): one row per
   output, `dedupe_key` `research:<run>:<key>`, `source_table` `cockpit_market_intel_runs`, `task_id` the card,
   `payload` `{kind:'research', effectKey, runId, taskId, docId, valueSha256 + valueChars | commentSha256 +
   commentChars}`, **never the link or the text** (the audit trigger copies payloads); the link stays on the run
   (`doc_url`) and the comment text in a column of the run (or an outputs table) that only the claim reads. Refused
   for a shadow run, for a Doc link that is not `^https://docs\.google\.com/document/d/`, and while
   `market_intel.apply_clickup` is off or the card is outside a non-empty `only_cards`. Called again for the same run
   (a run that resumes and publishes again, or a resend), it reopens a `failed` or `skipped` row of that `dedupe_key`
   (back to `queued`, `attempts` 0, `error` cleared, its `steps` and `progress` kept, so a write already on the card is
   found and never made twice) instead of deduping it away; a `delivered`, open or `sending` row is left as it is.
3. `cockpit_clickup_writeback_claim_research(p_token uuid, p_limit int)` (service role only): takes nothing unless
   `clickup-writeback:research` is younger than 15 minutes with a live mode (and only its `onlyCards` when
   `apply_limited`) **and** `market_intel.apply_clickup` is on; takes due rows and, as the forms and requests claims
   do, its own rows left `sending` for more than 10 minutes (the generic claim no longer takes them, item 1); per card,
   a newer run's rows wait while an older run's rows are open; field before comment; `attempts + 1`; returns each row
   with `run: {id, state, mode, docId, plan}` where `docId` is the run's `doc_id` and `plan` is `{taskId,
   fieldId:'7489dbcc-…', kind:'url', value:<doc_url>, replaceable:[doc ids of this card's live runs that finished
   before this one]}` for the field and `{taskId, text}` for the comment. It hands out a row only while its run is
   `publishing` or `done`, or has ended `failed` or `needs_person` with its Doc kept (`doc_id` the payload's `docId`);
   a row whose run is back in progress (`queued` through `checking`) is not handed out and stays as it is, no try
   used, until the run publishes again. A row whose run is gone, cancelled, a shadow run or ended without its Doc is
   settled `skipped` with a sentence. The writer checks the same again (above), so a claim that hands out a row of a
   run back in progress costs no try.
4. `cockpit_clickup_research_doctor_inputs()` (service role only): `{queue:{state:n}, oldestDue, stuckSending,
   field:'7489dbcc-fbbd-4eec-abfd-1306be7ff4b8', applyClickup, onlyCards}`.
5. A trigger on a research row's settle that mirrors the receipt onto the run (`field_state` `written` or `kept`,
   `comment_id`) with a `cockpit_market_intel_audit` row, and a minute kick (`pg_cron`) that posts `{"job":"research"}`
   only while a research row is due, as the forms kick does.
6. `research.test.ts` turns its skipped check on by itself once a migration in the tree defines the claim: every RPC
   `research.ts` calls defined there, revoked from `PUBLIC, anon, authenticated` and granted to `service_role` only;
   and, read from the definitions in force after every migration in the tree (`mi3Gaps`), the generic claim and the
   release list `research` in their kind `NOT IN`, begin and idle in their job `NOT IN`, and the research claim
   reclaims its own `sending` rows after 10 minutes and reads its run's `publishing` state.

**Deploy (at MI-3, after that migration):** `fdeploy.sh clickup-writeback <rev> --dry`, then live with the live
`verify_jwt`; `research_doctor` reads Ready; then `CLICKUP_WRITEBACK_APPLY_RESEARCH=true`,
`CLICKUP_WRITEBACK_RESEARCH_ONLY_CARDS=86eywg1cq`, `CLICKUP_WRITEBACK_RESEARCH_KEYS=field,comment`, `market_intel`
`apply_clickup` true with `only_cards` the test card; one run published on the test card, its field and comment read
back; then widen. Deploying this code before MI-3 changes nothing on any card: the job is not scheduled, and called by
hand it reads the gap above.

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
| intro (n = 25; revision 2: 36 questions, 11 long; 15 long since `20261102o`) | Tell us about your business so your onboarding call starts in the right place. It takes about 25 minutes. Your answers stay on this device, so you can finish it in more than one sitting. | عرّفونا على شغلكم عشان مكالمة الانطلاق تبدي من المكان الصح. تاخذ تقريباً ٢٥ دقيقة، وردودكم تنحفظ على هالجهاز، فتقدرون تكملونها على كم مرة. |
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
| number `range`, a decimal in a whole-number field (the onboarding's three revenues; round 4, drafted under the voice skill, **for the CEO's look**) | Write a whole number, with no decimals. | اكتب الرقم بدون كسور. |
| number `range`, outside min and max (the revenues: "2 million") | Write a number from 0 to 1,000,000,000. | اكتب رقم من ٠ لين ١٬٠٠٠٬٠٠٠٬٠٠٠. (existing sentence; the voice skill's 2026-10-08 rule says never to use the `٬` mark in on-screen Arabic numbers, and `formNumber` adds it to every number-range sentence: **the CEO's call**, left unchanged) |
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
Advertised takes the first one you tick.` It asks all 46 of `20261102o`'s questions: the five follow-ups each
after the question it follows, shown as `tG7dnxBn`'s logic shows them (the first four when their parent is
answered No, Contract changes needed after `Adjustments requested by client`; a hidden answer is never
sent). A question is required exactly where `tG7dnxBn` requires it (13 of them), and each text carries the
database's limit (4,000 characters for a long text, 500 for any other; the test reads both from the latest
`cockpit_kickoff_answers_check`) so an over-long answer is stopped before the send. Who else should we add to
the WhatsApp group? is a long text, as in `tG7dnxBn`. A long text is sent as Typeform hands it to Make
(`typeformText`, the sheet's copy of `cockpit_form_typeform_text`): `\r\n` and `\r` as a line feed, no white
space at either end, every line break, blank line, indent and repeated space between as typed, and counted that
way; a short text loses only the white space at its ends, and the database folds its spaces. A send the
database's check refuses stores nothing and keeps the sheet open with its answers: `The kickoff was not stored. {question}: {what to do}. … Then send it again.`, each question by its
words (a group's `Anything to add?` with its group) and what to do (`answer it`, `pick one of its choices`,
`shorten it to N characters or fewer`, `paste the whole link, starting with https://`, or the number's
limits), and, when the check names a question the sheet does not ask or a code the CSM cannot fix, `The
kickoff was not stored: the database did not take the sheet's answers. Your answers are still here. Tell
the tech lead.` Since round 4 the check can also answer `{_answers: too_large}` (2.9); `kickoffRefused` has no case
for it, so it shows that generic sentence, which is plain and harmless. It can only happen with control characters
(the sheet's maxima fit in any script). A specific line (`The kickoff was not stored: its answers together are too
long. Shorten the longest answers, then send it again.`) is a 2-3 line branch in `kickoffRefused`, not built (11.10).

### 5.14 Retired forms (cockpit, Settings → Forms, CEO and admins)

`SectionCard` `Old forms and scenarios`: rows `{name} · {kind} · {state words}` where states read `Still
on`, `Switched off {date}`, `Closed {date}`, `Removed {date}`, `Archive from {date}`, `Archived {date}`,
`Kept: {replacement}`; the replacement and the owner role under each. Empty: never (seeded).

### 5.15 The kickoff rail: the card's Drive folder and "Check with the client" (round 4, B5)

Design plan, written before the code under `mahara-context/skills/frontend-design/SKILL.md`, inside the cockpit's own
system. **Subject:** the CSM on a live kickoff call; the rail is their private notes panel (the kickoff window's side
panel and the kickoff deck's notes window, never the client's canvas). **One job:** say what in the client's own
answers to ask about before the CSM reaches that question. **Tokens:** no new palette: `--warning` for the dot and
the margin rule, `--foreground` for the sentence, `--muted-foreground` for the source, `--border` for the chip ring;
teal stays for links and the seal, because nothing here can be pressed. **Type:** Geist Mono 11px uppercase kicker,
the kit `Chip` (this app's status chip) at 12px medium for the question, Geist 14/20 for the sentence, Geist Mono 11px
for one source line. **Layout:** `CHECK WITH THE CLIENT · N`, then each question's chip above its sentence, then the
source once. **Signature:** a 2px warning-tinted rule down the list's left margin, like a reviewer's pencil mark.
Critique pass: the kicker's warn dot and per-row source tags were dropped (one marker too many). Parts in order:
Still missing, Check with the client, then client, order and sale; the part shows only when a flag holds, so a clean
record keeps today's order.

| Flag | Sentence (fixed; never the client's typed text) |
|---|---|
| Facebook answer is an Instagram link | Their Facebook page answer is an Instagram link. Ask for the Facebook page's link. |
| Facebook answer is not a Facebook link (facebook.com and its subdomains, fb.com, fb.me) | Their Facebook page answer is not a Facebook link. Ask for the Facebook page's link. |
| Instagram answer is not an Instagram link | Their Instagram answer is not an Instagram link. Ask for their Instagram link. |
| Website answer is a social, Linktree or Google Maps link | Their website answer is an Instagram, Facebook, Linktree or Google Maps link. Ask if they have a website. |
| Typed business name is not the card's (normalised in Latin and Arabic letters, neither containing the other) | The business name they typed is not the card's name. Confirm which name the ads use. |
| Last year's revenue under 1,000 (above 0) | Last year's revenue is under 1,000. Check the units. |
| 90-day goal above last year's whole revenue (both above 0; left out when the units flag holds) | Their 90-day goal is more than all of last year's revenue. Check both numbers. |
| Booking software: none given | No booking software given, so there is no system to connect. Ask how they take bookings today. |

**The Content row.** When the client's Drive answer is empty or not on drive.google.com or docs.google.com and the card
has a link, the row shows the card's link, labelled `The card's Drive folder`, with the source `ClickUp card, Drive
Folder` (or `… Drive Link`), reading `links.drive_folder` first, then `links.drive`, as the rest of the cockpit does.
A non-Drive answer adds `Their answer is not a Drive folder.`; with no card link either, their own link reads `Their
link`. Display only: the hidden values the Typeform kickoff link carries are unchanged, and the send is never blocked.
Checked by static markup tests; a 375px and dark-mode look in the browser is still owed (11.10).

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
difference"; "Roll back a migration with screens on it" (W12's row, now for `g` to `j`, and the Stage 4 fixes `l`,
`o` and `p`). Round 4 (X39) adds "A card field the form should have filled (`card_facts`)", "The cockpit brief is
missing from a task's description" and "The kickoff notice's Still open line". No guardian check changes in round 4:
`stage4-effects` already warns on a `failed` or `unknown` effect, and a `skipped` `card_facts` (every field kept) is
neither.

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
| D-S4.0 and D-S4F fixes (`forms-s4-fixes`) | Run file by file (counts read 2026-11-02 after round 3, `20261102o` as it now stands). `cd apps/media-buyer-cockpit && bun test scripts/stage4-native-supabase.test.ts` (40 pass; was 37; it applies `j`, `l` and `o`), `bun test scripts/stage4-content-folder-supabase.test.ts` (5) and `bun test scripts/stage4-match-make-supabase.test.ts` (33; was 25: `o` on `l`); `bun test scripts/forms-writeback-supabase.test.ts` (57) and `bun test scripts/requests-fit-supabase.test.ts` (15), which import the writer; from the root, `bun test hermes/forms-relay/relay.test.ts` (10); `bun test hermes/client-messages/<file>.test.ts` for each file (core 18, worker 65, g5 7, ledger 9, oldSenders 10, whapi 13); `cd supabase/functions/cockpit-forms-api && bun test <file>.test.ts` (messages 22, was 17; door 20; recapRules 17; drafts 51); `cd supabase/functions/clickup-writeback && bun test <file>.test.ts` (requests 109, was 94; forms 65, was 58; run 102; reviewR1 20, taskActions 42, queue 19, migration 8, billing 45, kpi 48, rules 19, launchFallback 1); `cd supabase/functions/comment-watch && bun test watch.test.ts` (25); `cd apps/client-success-cockpit && bun test scripts/client-messages.test.tsx` (69; was 68), `bun test scripts/kickoff-sheet.test.tsx` (13: 12 pass and 1 skipped without `MAKE_PARITY_SAVED_DIR`, 13 pass with it; was 6) and `bun test scripts/forms-editor.test.tsx` (23; was 22); `python3 scripts/dev/test_make_parity.py` (33 run, 1 skipped without `MAKE_PARITY_SAVED_DIR`, 33 OK with it; was 30); `cd hermes/cockpit-guardian && python3 -m unittest tests.test_wins_cash` (24). Asserts: `l` applies after `j` from the live state (version 1) and after a go-live (version 2), twice, with one audit row; its drift guard takes `j`'s bodies and its own and stops on anything else; the outbox refuses a `client_data_row` row and the file stops on one; the builder, the parity plan and the arrays equal `j`'s without `client_data_row`, the kickoff identical; the relay skips a stray `client_data_row` row, writes no sheet and lets only GitHub calls out; both phase templates pass `cockpit_form_stage4_message` with `{content_folder}` kept once; the worker fills the link only in the one send, masks it back in every group search, and refuses a missing, non-link or column-less link before the wait; the Messages card shows the placeholder as the Client Data link; the evaluator's functions, filters, routers and iterator; fidelity read as ClickUp returns comments; `setting missing` and `NOT PROVEN`; no name, answer, phone or token in any printed line. **`o` (X37):** it applies twice on `l` and leaves `j`'s input and parity plan as they are; it stops with `Apply 20261102l before 20261102o.` on `j`'s builder and on any other changed body; only the owner runs its ten functions; `onboarding.raw_titles` is seeded `{}`, and `stage4-raw-titles.json` equals the evaluator's titles of the saved `KFRCXPFx` (36, in its order); on invented answers the SQL equals `make_parity.py`'s evaluator (run with `python3 -I` on the fixtures) for the handoff and the comment on each onboarding task (empty values; numbers such as 0, 0.0, -0, 1500.50, 1,500 and Arabic-Indic digits; yes/no as true, false, missing and other text; lists as ticked; Arabic text; a handoff over 4,000 characters; both hidden-value sources), Service Advertised (the option ticked first, or nothing), the kickoff's hidden values (Make 13 [29]'s link, with and without an onboarding answer), the raw answers comment (the form's order and full titles, 0 blank, a retired question last), the Client Profile and the dispatch, through the text functions, the parity plan and native answers through the planner; the request keeps the handoff whole on `task_comment` and each part's `taskComment` with no details (no part's description holds the handoff; proven with the real `cockpit_request_plan` in the native chain test too), the Client Profile is Make's text whole (over 5,000 characters too) with the kickoff link in its row, and the Brand DNA task has no details and no comment; an empty or partial `onboarding.raw_titles` gives its `missing` sentence while every other effect stands; the five follow-ups and a Yes/No Post call form filled pass the answers check; every other effect equals `l`'s under two settings states. **Typed text (round 3):** `cockpit_form_typeform_text` turns `\r\n` and `\r` into a line feed, trims what JavaScript's `trim()` trims and keeps everything between; the onboarding's answers check keeps each text so (counted on what is kept; a no-break space alone is blank) and takes the longest stored `KFRCXPFx` answers, while every other form folds exactly as `i`'s body does; the kickoff check keeps a long text so and folds a short one; the version-2 guard changes `j`'s definition in place only while nothing uses it and stops on a used or changed one; the schema caps are 1,000 and 10,000 for the onboarding only; multi-line Arabic and English answers give the evaluator's handoff, Client Profile and raw answers comment; native typed answers (`\r\n`, double spaces, a no-break space and U+3000 at the ends, Arabic) go through the check, the stored response, the input and the build and equal the evaluator for the raw answers comment, Client Profile, dispatch, read model, kickoff hidden values and the next kickoff's handoff; `portal_form_submit` keeps line breaks and spaces end to end. **The writers (round 3):** the task comment step order (`request_type` < `task_comment` < `card_comment`, and in a template part); no step for an undefined, null, blank or white-space `taskComment`; one post, byte for byte, no ref, `notify_all` false; resume after an unanswered POST found by its text after ClickUp rewrote it (stars and rule lines dropped, `\_` escapes, `\r\n` and spaces changed; behind 27 newer notes on the forms side); resume after an answered POST found by its id even when the text changed; an answered id that is gone is never posted again; the read-back after a post goes by the answered id; a comment one line short or long, one word different, dated before the window, or with another response's ref is never taken; the old writer's marker still finds its comment and a step it froze is posted without its ref; a ClickUp 400 on the task comment leaves the part delivered with its note; a gone task stops the part before a second post; a part frozen before the step never posts it; the dry run and every save hold the length only; `payloadProblem` bounds; a 6,000-character Client Profile with emoji, Arabic and doubled spaces and a link over 5,000 are POSTed unchanged while a non-string, `http` or wrong-kind value still fails; `test_make_parity.py` reads `REF_LINE` and `TASK_COMMENT_STEP` from the writer's source. **The cockpit (round 3):** the kickoff sheet reads both caps from the latest `cockpit_kickoff_answers_check`, `whatsappAdd` is `{type: longtext, max: 4000}`, `\r\n`, a lone `\r`, a no-break space at the ends, blank lines and indents behave as the database keeps them; the forms editor's Longest answer cap equals the latest `cockpit_form_schema_check` (onboarding 1,000 and 10,000, every other form 200 and 2,000). **`cockpit-forms-api`:** a phase draft is approved with the exact text, its sha256, the verified actor and no warnings; refused when empty, over 1,500 characters, holding `{content_folder}` twice or any other placeholder, or by the client text rule, and only as a draft; a recap still needs the booking block. **The cockpit:** the edit counter reads `/ 1,500` for a phase text and turns red past it; the kickoff sheet's fields equal the latest migration's list (keys, refs, options, text types and limits) and `tG7dnxBn`'s order, types, required flags and logic (all 480 combinations of the parent answers; the saved definition itself when `MAKE_PARITY_SAVED_DIR` is set); lists go in the order ticked; a refused send shows its sentence and no `Sent.`. |
| Better data, round 4 (X39; `forms-s4-fixes` and the portal's `forms-s4-portal`) | Counts read 2026-11-02 at the end of round 4; where a file is in the row above, this count replaces it. `cd apps/media-buyer-cockpit && bun test scripts/stage4-better-data-supabase.test.ts` (new: 34 pass, 935 expects), `bun test scripts/stage4-match-make-supabase.test.ts` (47; was 33), `bun test scripts/stage4-native-supabase.test.ts` (43 pass; was 40), `stage4-content-folder` (5), `forms-writeback` (57), `requests-fit` (15); `cd supabase/functions/clickup-writeback && bun test forms.test.ts` (76; was 65), `run.test.ts` (103; was 102; requests 109, queue 19, migration 8, reviewR1 20, taskActions 42, billing 45, kpi 48, rules 19, launchFallback 1 unchanged); `cd supabase/functions/cockpit-notices && bun test` (210; was 201); `cd supabase/functions/comment-watch && bun test watch.test.ts` (27; was 25); `cd apps/client-success-cockpit && bun test scripts/form-rail.test.ts` (37; was 20) and `scripts/client-brief.test.ts` (92); kickoff-sheet 12 + 1 skipped and forms-editor 23 unchanged; `tsc -p tsconfig.app.json --noEmit` clean; `python3 scripts/dev/test_make_parity.py` (48 run, 1 skipped; all OK with `MAKE_PARITY_SAVED_DIR`; was 33). Portal: `npm test` (1,967 pass; was 1,960) and `npm run typecheck`. Asserts: **`o` round 4:** revenues refused as text, words, negative, decimal or over 1e9 and accepted at 0, 1e9, 60000.0 and 1.5e6; a native number prints in the Client Profile, the raw answers comment and the kickoff link's values exactly as the evaluator prints Typeform's; the Typeform door stores the portal's answers, revenues as numbers (`cockpit_form_stage4_numbers`); links https and `mapsLink` plain; 14 phone shapes reach E.164 and 10 are refused, every other form matching `i`; the audit rows of a native kickoff hold `taskCommentChars` and no `taskComment` or contact value, and keep their grant; a kickoff's answers stored to 256 KB, `too_large` only alone, and the table's 64 KB/256 KB/1 MB rooms. **`p`:** applies twice on `o` and stops on `o`'s missing or changed builder; every other byte of every effect equals `o`'s over 96 combinations; each brief's header, kind, line and cap, the B1 drop order's first three levels one at a time, max distance hidden without onsite, the no-onboarding and no-setup-answer cases, no full name, personal phone or email in any brief; `detailsMissing` when the type has no `details` field; `card_facts` per field and source (labels only when every ticked type maps, one platform only, a fathom.video link before the call store, the call's day before the kickoff's, no date without a submit time, Company Website only on an own https site), skipped with a sentence when empty and on a second kickoff; `openItems` absent, `[]` or listed by fixed labels with typed or unknown choices unanswered; the arrays (kickoff 10, onboarding 8) and the registry move with its audit row. **The writer:** the plan check refuses everything outside the allowlist with no call; empty fields written once with exact bodies and the receipt saved first, no values in progress; set fields kept with or without a note, labels never added to; nothing to write is `skipped` with the trail sentence and a retry makes no call; races, read-back misses, a 429 on a first or later write, a missing option or field; the doctor's three new sentences. **Notices:** placement in both variants and before the second-kickoff line, the nothing-open line, no line for a missing or non-array list, unknown items counted, the allowlist equal to `kickoff.ts`'s labels, typed text never reaching Slack. **comment-watch:** a 13,500-character kickoff comment whole, 20,000 cut at 16,000, other kinds at 12,000. **Rail and brief:** each check flag firing and not, the Drive fallback, fixed sentences only, hidden values unchanged, `CheckPart` markup; the six GCC dialling codes, `00` and punctuation, the front-desk phone never read, billing before phone. **Parity:** 4.15.1's negative tests. **Portal:** the copy's md5 `bc89ca36…`, each cap on both sides, typed text kept, revenues, links and phones, the keypads and inputs on the real form, a 300 KB Arabic answer reaching the RPC whole and 413 past 1 MB + 16 KB. |
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
| D-S4F | **Stage 4 fixes and better data, after branch `forms-s4-fixes` is reviewed and merged (X34 to X39), and only once nothing in 11.9's or 11.10's open tables is marked before the merge:** (0) **The oracle run** (4.15.5; the Mac, read only) on the merged tree, before anything is applied. (1) **`20261102l`:** the letter rule (live held `j` and `k` on 2026-11-02, so `l` was free); `python3 scripts/dev/forms-deploy/guard_check.py supabase/migrations '20261102l*'` (widened on this branch to match function names with digits; read 2026-11-02: `n` 2, `live` 2, `odd` null), live must be `afa3e203…` and `a704e72a…`; save `before-cockpit_form_stage4_effects.sql`, `before-cockpit_form_stage4_build.sql`, the two outbox CHECK definitions and the onboarding registry `effects`; `mig.py dry` then `mig.py apply`. (2) **`clickup-writeback`, before `o` and `p`** (4.13.4; the ship order): the request writer's `task_comment` step, the Stage 4 comments posted as Make's text alone, Stage 4 text fields of any length, and `card_facts` (round 4: `STAGE4_KEYS`, `factsStep`, the `CARD_FACTS` allowlist and the forms doctor's field checks): `fdeploy.sh clickup-writeback <merge rev> --dry`, then live with `--verify-jwt` equal to the live value (read it again; W34 read `off`). It goes before (3) because the writer freezes a request part's steps before its first write, so a part frozen by the previous writer never posts its `taskComment`; and before (3b) because a `card_facts` queue row reaching a writer without the key fails as a mismatch. Until (3) no payload carries a `taskComment` and `CLICKUP_WRITEBACK_FORMS_KEYS` lists no Stage 4 form, so nothing it writes changes. (3) **`20261102o`, right after (2)** (2.9): the letter rule again (first drafted as `20261102m`; the goals sheet's `20261102m_goal_sheet_truth` and `20261102n_goal_sheet_media_dedupe` reached live and main first, so this file and (3b) took `o` and `p` on the branch and 2.1 was amended, 11.2-x and 11.10; read the letters again before the apply); `guard_check.py supabase/migrations '20261102o*'` (read 2026-11-02, round 4: `n` 11, `live` 10, `odd` the builder; after (1) the builder must read `l`'s after `7e5f7fda…` and the other ten their live values, the queue audit trigger `d595491b…` and the onboarding Typeform door `25a79429…`); `select md5(schema::text) from public.cockpit_form_versions where form_key = 'onboarding' and version = 2` reads `8fa1f38d…` and no response or invite uses version 2 (counts only; the in-place window for B3 closes at the first invite); save `before-` of the eleven functions 2.9 replaces (the queue's `cockpit_clickup_writeback_audit()` and the onboarding Typeform door `cockpit_form_onboarding_typeform(jsonb)` included), the onboarding's version-2 schema (`before-onboarding-v2-schema.json`), the definition of `cockpit_form_effects_plan_check` (it must read `20261027f`'s 131,072 bytes) and the definition of `cockpit_form_responses_answers_check` (it must read `20261102f`'s: 1,048,576 bytes for `new_client` and `onboarding`, 65,536 for every other form); `mig.py dry` then `mig.py apply`. (3b) **`20261102p`, right after (3)** (2.10): the letter rule again (first drafted as `20261102n`; renamed with (3) because live and main took `20261102m` and `20261102n` for the goals sheet, 11.2-x and 11.10); `guard_check.py supabase/migrations '20261102p*'` (read 2026-11-02: `n` 3, `live` 1, `odd` the builder and the effects; after (1) and (3) the builder must read `o`'s after `a565db2d…`, the effects `l`'s after `1b01ccc5…`, the kickoff facts their live `3ecb0f63…`); save `before-` of the three functions it replaces and both registry `effects`; `mig.py dry` then `mig.py apply`. (4) **`onboarding.raw_titles`** = `scripts/dev/forms-deploy/stage4-raw-titles.json` from the merge, as it is (owner SQL, `updated_by` `deploy D-S4F`), right after (3). (5) **client-messages release** (file-scoped, `hermes/client-messages/RUNBOOK.md`): staged doctor and dry run, link swapped under the worker lock; `CLIENT_MESSAGES_KINDS` unchanged. (6) **`cockpit-forms-api`** (phase drafts approvable, 11.8, 11.9): `fdeploy.sh cockpit-forms-api <merge rev> --dry`, then live with `--verify-jwt` equal to the live value (read it again; W34 read `on`); then `scripts/ship.sh client-success` from the merge (the Messages card draws `{content_folder}` as the Client Data link and counts a phase text to 1,500; the forms editor caps the onboarding's texts at 1,000 and 10,000 characters; the kickoff sheet with its questions, long texts sent as typed, stays behind `forms.stage4.kickoff`; the kickoff rail's Check with the client and the card's Drive folder, and the CSM brief's assumed currency, are display only and live on ship, 4.16). (7) **forms-relay release** of the new files (`hermes/forms-relay/RUNBOOK.md`); `~/.forms-relay/config.env` holds only `DISPATCH_OWNER`, `DISPATCH_REPO`, `DISPATCH_EVENT`, `DISPATCH_NAME_KEY` and `DISPATCH_ID_KEY`, from Make 13 [25] in the saved blueprint (no `CLIENT_DATA_*` line; the relay holds no Google key); `GITHUB_DISPATCH_TOKEN` in `keys.env` is still the CEO's to add; `FORMS_RELAY_APPLY=false`; then the guardian's `checks/wins_cash.py` and `checks/queues.py` released under its run lock (the `relay` check now names only the dispatch; the two ClickUp queue checks say how to find a comment that carries no ref; round 4 changes no guardian code). (7b) **`cockpit-notices` and `comment-watch`** (round 4, B4 and B7; either order against (3b): a notice queued without `openItems` prints no line): `fdeploy.sh cockpit-notices <merge rev> --dry` and `fdeploy.sh comment-watch <merge rev> --dry`, then live, each with `--verify-jwt` equal to its live value (read it again). (8) **`stage4.messages`** = the two templates of X35, verbatim from `MESSAGES` in `apps/media-buyer-cockpit/scripts/stage4-content-folder-supabase.test.ts` (owner SQL, `updated_by` `deploy D-S4F`), only after (5) is live. (9) The fills D-S4.0 held: the request types `client_onboarding` (two targets, 4.13.3) and `brand_dna` (4.14.3; no template, as Make 13 [46]) through `cockpit_request_type_add`, the ClickUp Request Type option added first, **each with a field `{key: 'details', kind: 'details'}`** (round 4, 2.10: `cockpit_request_create_system` keeps details only for a field keyed `details`, and `cockpit_request_plan` prints them only for kind `details`; without it the brief stays out of the task and the parity run says so). Live 2026-11-02: neither type exists (0 of 2). (10) `make_parity.py kickoff` and `make_parity.py onboarding` on the VPS from the merged file | (0) the harness's last lines: `PASS` for both forms, the kickoff on both hidden-value passes: every effect `equal` or `intended`, `onboarding_tasks` included (graded against the writer's own `TASK_COMMENT_STEP` and an empty `REF_LINE`; the plan carries no details), `onboarding_tasks_runner` equal, and `PASS: the onboarding form keeps typed text through the native store`; since round 4 also `onboarding_tasks` and `brand_dna_task` reading `equal + intended: task_name, dedupe, request_route, brief` (or `dna_brief`), `card_facts` `intended: card_facts (receipt not read)`, `brand_dna_task_runner` equal, the native store keeping every number, `delivery: 12 of 12 registered briefs reach every part's description whole` and `PASS: the additions keep the contracts between the planner, the writer, the notice and the portal`; the deploy log keeps counts and verdicts only (round 3 on the branch, 11.9, and round 4, 11.10: all of these). (1) both md5s read the after values `1b01ccc5…` and `7e5f7fda…` (`guard_check.py` again: `after` 2); the outbox CHECKs read `effect_key = 'github_dispatch'` and the `github_dispatch` dedupe pattern; the onboarding registry `effects` equal `cockpit_form_stage4_effects('onboarding', 1)` (the go-live drift check's condition), neither onboarding array holds `client_data_row`, the kickoff arrays are unchanged; one audit row `forms.stage4_no_client_data_row`; both ACLs owner only. (2) the function's version and `updated_at` moved, `verify_jwt` unchanged; the requests doctor (`{"job":"requests_doctor"}`) ok, and `clickup-writeback:requests` and `clickup-writeback:forms` report the mode they reported before the deploy; the writer's tests green on the merge (requests 109, forms 76, run 103). (3) `guard_check.py … '20261102o*'`: `after` 11; fifteen functions of 2.9 owner only (no EXECUTE for PUBLIC, anon, authenticated or service_role) and `cockpit_clickup_writeback_audit()` and `cockpit_form_onboarding_typeform(jsonb)` with their live grant (service_role) unchanged; `cockpit_requests.task_comment` exists; `cockpit_form_stage4_fields('kickoff')` holds 46 entries with `whatsappAdd` `longtext`, and `('onboarding')` 36 with `address`, `hours`, `landmark` and `appointmentLength` `longtext`; the onboarding's version-2 schema md5 reads `bc89ca36…` (its three revenues `number` 0 to 1,000,000,000 with 0 decimals, its four links `format url`, `mapsLink` plain), with one audit row `forms.stage4_long_texts`, and the registry row still reads `typeform`, version 1; `cockpit_form_responses_answers_check` reads 262,144 bytes for `kickoff`, 1,048,576 for `new_client` and `onboarding`, 65,536 else; `select public.cockpit_form_typeform_text(E' a\r\nb  c ') = E'a\nb  c'` is true; `cockpit_form_effects_plan_check` reads 2,097,152 bytes for `kickoff` and `onboarding` and 131,072 for every other form; `onboarding.raw_titles` reads `{}`. (3b) `guard_check.py … '20261102p*'`: `after` 3 (`5f52c05d…`, `a9cb7e47…`, `4e47c07e…`); its fourteen functions owner only; `cockpit_form_stage4_effects('kickoff', 2)` holds 10 entries with `card_facts` after `card_fields`, `('onboarding', 2)` 8 with `card_facts` after `profile_fields`, both version-1 arrays unchanged; both registry rows still on version 1 with their version-1 arrays and no `forms.stage4_card_facts` audit row (one per form only if a go-live came first). (4) its `fields` hold 36 entries whose refs, in order, and titles equal the file's (compared on the Mac; print counts and booleans only). (5) doctor ok; `run.sh doctor --task 86eywg1cq` prints `driveLink` (it must read `present` before any canary); a run prints "Nothing approved to send.". (6) the function's version and `updated_at` moved, `verify_jwt` unchanged; `ship.sh`'s own checks pass; the phase approve itself is proven by D-S4K's canary. (7) the doctor names no Client Data line and no Google key, only what is still missing (the token); a run prints "Nothing to relay.". (7b) each function's version and `updated_at` moved, `verify_jwt` unchanged; the notices dry run (`{"job":"dryRun","responseId":"<the newest kickoff's response_id>"}`) builds the kickoff notice with its `Still open from the kickoff: …` line once (3b) is applied (before it: no line). (8) `cockpit_form_stage4_message('phase3' / 'phase4', <the test card's client>, cockpit_form_stage4_map_url(3 / 4, '86eywg1cq'))` returns a `body` and no `missing`: the map link filled, `{content_folder}` kept exactly once, 1,500 characters or less (print booleans and lengths only). (9) both types listed with their targets and their `details` field (key and kind `details`); `select public.cockpit_form_stage4_details_note('client_onboarding'), public.cockpit_form_stage4_details_note('brand_dna')` gives two nulls. (10) `PASS` for both forms; each `differs` of 11.8 and 11.9 gone, or recorded as intended in 11.1 first, with the CEO's word (X37, X39); no `the brief would be dropped` | (0) none: it only reads. (1) the saved bodies, both CHECKs from their saved definitions and the registry `effects` from the saved array, in one transaction (a body without its matching array fails the go-live drift check), and only after (3) is rolled back. (2) `clickup-writeback` back to its previous version only while `o` and `p` are not applied, or after (3b) and (3) are rolled back: with `o` applied, a part frozen by the previous writer never gets its task comment, the Stage 4 comments carry the ref line again and a Client Profile over 5,000 characters is refused; with `p` applied, a `card_facts` row fails as a mismatch. Before D-S4K only canaries are at stake. (3) only after (3b) is rolled back: the ten saved bodies (the queue's audit trigger keeps its service_role grant) and the saved version-2 schema in one transaction (the schema only while no answer or invite uses version 2); `cockpit_form_responses_answers_check` from its saved definition only while no `kickoff` answer is over 65,536 bytes (count first; otherwise it stays, as the plan CHECK does); `task_comment`, `onboarding.raw_titles`, the five new functions and the 2 MB plan CHECK stay (only `o`'s bodies read or call the functions, and a plan already over 131,072 bytes would refuse the old CHECK); restored, the onboarding's answers are folded again, its phones checked by `i`'s pattern, and its version 2 is `j`'s again (revenues as text, links without the url format). (3b) the three saved bodies (`o`'s builder, `l`'s effects, the live kickoff facts) in one transaction with the saved registry `effects` when `p` moved them (a row left on `p`'s version-2 array after its body is gone fails the go-live drift check); the eleven new functions stay (only `p`'s bodies call them). The briefs, `card_facts` and the open-items line then stop for new answers; queued `card_facts` rows still run on the writer from (2). (4) `onboarding.raw_titles` back to `{}` (the raw answers comment then fails with its sentence). (5) the link back to `b7ab2d11` (no phase kind is listed, so nothing sends a template). (6) `cockpit-forms-api` back to its previous version (its rev recorded before the deploy), so phase drafts cannot be approved; the cockpit back to its previous deployment. (7) the link back to `b7ab2d11` (after (1) the outbox holds no Client Data row for its old path to write); `config.env` back to empty; the guardian's previous `checks/wins_cash.py` and `checks/queues.py`. (7b) each function back to its previous version (revs recorded before the deploy): the notice loses its line, the digest cuts every kind at 12,000. (8) `stage4.messages` back to `{}`. (9) the types stay: only the Stage 4 planner files them, and it runs for no real card before a go-live. (10) a `FAIL` or `NOT PROVEN` stops Stage 4: fix on a branch, deploy it the same way, run (0) and (10) again |
| D-S4K | **Kickoff native (one hour), only after D-S4F passed (the oracle run and the VPS run, the phase approve deployed, the request writer posting the task comment, `p` applied, the request types seeded with their `details` field) and the CSM lead has been told that `card_facts` can fill an empty Onboarding Call Date, which moves `csmCadence` (4.16). The queue audit's handling of the handoff, open in 11.9, is decided and built (`o` round 4: `taskCommentChars`):** note the window start; `run.sh doctor --task 86eywg1cq` (client-messages) reads `driveLink present`; `CLICKUP_WRITEBACK_FORMS_KEYS=checkin,kickoff`, `CLICKUP_WRITEBACK_FORMS_ONLY_CARDS=86eywg1cq`, `CLIENT_MESSAGES_KINDS` + `phase4` with `CLIENT_MESSAGES_ONLY_CARDS=86eywg1cq`, `FORMS_RELAY_APPLY=true`; the forms doctor (`{"job":"forms_doctor"}`) with `kickoff` in the keys reads ok (the five `card_facts` fields on Clients - Mahara with their types and every allowlisted option; a changed option is fixed in `CARD_FACTS` on a branch first); canary kickoff submit on the test card as the CEO's seat: every effect read back (the handoff comment byte-equal to the plan's, with no ref line; status; the nine fields, Service Advertised the option ticked first; Blueprint link; `card_facts`: each planned field written only where the test card had it empty and read back, a set one `kept`, `progress.steps.card_facts.fields` holding states and no values; map URL; two tasks made, each part's frozen `steps` listing `task_comment` between `request_type` and `card_comment`, each task's description holding the request's heading and then the brief (its first line `From the onboarding and kickoff forms (cockpit)`, 3,600 characters at most; print booleans and lengths only), each task with exactly one comment byte-equal to the handoff (found by the id ClickUp answered), and that comment as ClickUp returns it equal to the handoff under `commentKey`, which checks the writer's read-back rule once on live data (print booleans only); the audit rows of both parts hold `taskCommentChars` and no `taskComment`; then cancelled through `cockpit_request_cancel` with the reason "Canary on the test card"; the phase 4 draft approved and **sent to the test card's internal group** with the test card's content folder link in place of `{content_folder}`, and read back, notice muted (its dry run shows the `Still open from the kickoff` line or the nothing-open line), `mrr` voided); clear the card lists; `cockpit_form_stage4_go_live('kickoff', true, ...)` (the registry `effects` read back equal to `cockpit_form_stage4_effects('kickoff', 2)`, 10 entries with `card_facts`); a second canary on the test card later finds the filled fields set and reads `kept`; edit Make `8979157` module [45] so its Kickoff Form Link `87d7d889` is the cockpit kickoff link (blueprint saved, only that value changed, diff read back, the scenario stays active); save and close `tG7dnxBn`, remove `WHTP3992232` and the `postcallsummary` webhook on it (lists before/after), switch off Make `8925654` (read back) | the parity record from D-S4F linked in the log; each canary read-back; registry native with the version-2 array; the [45] diff; scenario off; the first real kickoff watched (D-Z) | go-live off (version-1 array back); scenario on from its blueprint; 8979157 restored from its blueprint; form reopened; webhooks re-added; kinds and keys back |
| D-PB | **The Client Profile backfill (4.17), after B1 is live and, recommended, after D-S4K; with Supabase egress back:** save `before-cockpit_form_effect_gate.sql`; the letter rule and `guard_check.py supabase/migrations '20261103c*'` (live = `a683c236…`); apply `20261103c`; read back `to_regprocedure('public.cockpit_form_profile_backfill(text,text[],text)')` non-NULL, the gate's md5 `4ca44d25…`, its `proacl` the owner's only and the function's `{postgres=X/postgres,service_role=X/postgres}`; dry run on `86exnk0v4`, `86ey3303x`, `86eyew6mt` (expected 3 `would_queue`, answered 6/7/6, 265/283/577 characters, sha256 `9553c5c35200`/`3e413fc47bfd`/`1854c2482e00`; counts and prefixes only in the log); **stop gate:** the CEO is asked the RUNBOOK row's step (2) question (the same words as 4.17) and the deploy goes on only after he answers yes to the three, otherwise nothing further is done; FORMS_KEYS read from the doctor and `profile_backfill` added (never the list replaced), doctor Ready; apply `86exnk0v4` alone, then the other two (actor `CEO-2 approved 2026-11-02 (Sure); scope re-confirmed by the CEO on <YYYY-MM-DD>; D-PB`, the date and the confirmer of that yes), the RUNBOOK row's reads after each; the lane taken out once no backfill row is open | per card: the queue row `delivered`, `progress.steps.profile_backfill.fields` `{before: empty, state: written}`, the effect `delivered`, 3 ClickUp calls; after one onboarding-sync the mirror equal to the plan's text as a boolean; at the end 0 in onboarding with an answer and an empty profile, 28 of 42 empty overall | before a write `cancel` and the lane out; after one, a person clears the field (each was empty before), only on the CEO's word; the gate's saved body |
| D-S4O | **Onboarding native (one hour), only after D-S4F passed (the phase approve deployed, `onboarding.raw_titles` filled; 11.9), the portal release that keeps the onboarding's answers as typed, takes its version 2 and sends Typeform's typed inputs (round 4: numbers, https links, E.164 phones; branch `forms-s4-portal`) is live (11.9, 11.10), the CEO has answered CEO-1 (where the market intel job reads the answers: **urgent**, section 10) and has looked at the drafted questions and the new whole-number sentence (1.3, 5.10):** keys + `onboarding`, kinds + `phase3`, card lists narrowed to the test card; the forms doctor with `onboarding` in the keys reads ok; canary `cockpit_form_invite_canary('onboarding', ...)`, answer by link in the built-in browser, every effect read back (the canary's answers include a long text the Client Profile shows, such as the top three challenges, with a line break and a double space, which read back unchanged in the stored response, the raw comment and the profile; a revenue typed with separators, a `www.` website and a phone typed with spaces or `00`, which read back as a number, an `https://` link and E.164; the profile text byte-equal to the plan's, whole; kickoff link; the raw comment byte-equal to the plan's, with the full titles and no ref line; Company Website (`card_facts`) written only if the test card's field was empty; map URL; Brand DNA request made, its description holding the request's heading and then the brief (first line `For the Brand DNA doc (cockpit)`, 3,600 characters at most), then cancelled the same way, the phase 3 draft approved and sent to the test card's internal group with its content folder link, read back; nothing written to Client Data; GitHub dispatch: relay dry print compared with the blueprint's body, its client name the typed Business Name, not sent for the test card); a signed forms-door probe with a recorded `KFRCXPFx` payload rewritten to the test card shows it is stored `legacy` (the card is already answered) with no effects; clear the lists; `cockpit_form_stage4_go_live('onboarding', true, ...)` (the registry `effects` read back equal to `cockpit_form_stage4_effects('onboarding', 2)`, 8 entries with `card_facts`); remove `WHTP3991048` (Make's hook) and switch off Make `8922994` (read back). `KFRCXPFx` **stays open** and Make `8979157` [40] is **not changed** (X26): its link now feeds the native planner through forms-door | each read-back; the portal's Getting started shows the native form for a staff preview; the first real native onboarding answer (portal or Typeform door) watched: its relay row `sent` (market intel dispatched), its phase 3 message sent with the card's content folder link (D-Z) | go-live off (the embed returns, version-1 array back); 8922994 on; webhook re-added |
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
- **Match Make (X37): what cannot match without his word** (11.9). The ref line the writer added after every Stage 4 comment is gone (round 3, 4.13.4): under "match Make" the comments that mirror Make's carry its text alone and are still posted exactly once, found again by ClickUp's id or by their text, so it no longer waits on him. (1) What the request route adds to the three tasks Make makes (a description rewritten as the template's text, a rule, the request's own lines and its marker `Cockpit ref R-…`, which keeps a task from being made twice; a due date, a priority, owners by rule on the onboarding tasks, the client tag, the Request Type field and a link comment on the client card per task) no longer waits either: his later words (X39) make it intended (`request_route`, 4.15.1). The route stays (X38). Still waiting: (2) The phase 3 map and message for a card with no Client Data row or several (Make acts once per row; the cockpit moves the map once and sends only for exactly one row). (3) A Business Name holding `"`, `\` or a line break: Make 13 [25] pastes it into its JSON unescaped and its request fails; the relay sends it escaped, so matching would copy the failure. The parity run does not grade these (it reads the plan).
- **Better data (X39): the CEO's decisions still open** (the better-data plan's "For the CEO", each with its
  recommendation; none is built):
  - **CEO-1, decided 2026-11-02: replicate and improve the market intel job inside the cockpits** (build MI-1, 4.23;
    MI-1b, MI-1c, MI-3 and MI-4 follow). Still open for D-S4O: the owner's answer below (MI-0), the Apify key and
    budget, and the engine. The original question, kept for the record:
  - **CEO-1, urgent, before D-S4O: where the market intel job reads the answers, and the dispatch keys.** The job
    most likely reads Typeform (its folders are keyed by response hash and its report reads back all 36 answers); the
    market intel repository could not be read from this seat. If it does, a portal-native onboarding gives it nothing,
    and the Research doc's Onboarding Answers tab, the call-center knowledge base (so the dialer) and the tech kit's
    Typeform source go empty. Step 0, now: ask the job's owner and the tech kit's owner where they read the answers.
    Option A (recommended if they read Typeform and the workflow takes extra keys): keep Make's two keys byte-equal and
    add `source`, `response_id`, `card_name`, `submitted_at` and one `onboarding` object with every answer except the
    five contact refs (at most 15,271 bytes, under the outbox's 16 KB; check the serialized size and fall back to a
    research subset of at most 5,998 bytes), 7 of GitHub's 10 keys, behind the relay's `DISPATCH_EXTRA_KEYS` allowlist,
    off until the owner confirms. Option B: send `response_id`, `source` and `card_name` only, plus a new server-gated
    cockpit read for the job (another door, in the health ledger). Trade-off: A puts business answers into that
    repository's Actions events; the job already copies the same answers into its report doc.
  - **CEO-2: decided 2026-11-02, "Sure" (B2, `20261103c`, 4.17); built. Before the first write he is asked whether to
    fill the 3 cards anyway (all GHOSTED; the 6 Active cards with an empty profile stay out), and D-PB stops unless
    he answers yes (4.17; RUNBOOK step 2).** The question as it was put:
    **Client Profile backfill.** 31 of the 42 cards with stored onboarding answers have an empty Client Profile
    (every card from April to July, 5 from August). Recommended: only cards still in onboarding (3 today), Make's exact
    text, only where empty, through the writer with audit rows, after a dry run; skip launched clients.
  - **CEO-3: decided 2026-11-02, "Yes" (B0, `20261103b`, 4.18); the exact English and Arabic in 4.18 wait on his
    approval before the apply.** The question as it was put: **the native onboarding's hints and optional questions
    (client-facing).** Restore 7 hints Typeform shows (the
    access link on the Meta question, the consultants format, examples for hours and appointment length, a few more)
    and "in English" on the Arabic Business Name label (Arabic under the voice skill); make address, projects completed
    and landmark optional again (skipped 9, 12 and 3 times); decide on a phone country picker (default the billing
    country, else Saudi Arabia). Recommended: approve the hints and optional flags now, so they ride the same in-place
    window as B3 (version 2 unused) before the first invite; after it they need a version 3. Max distance waits (its
    show-if needs an "includes" operator).
  - **CEO-4: a version 3 with structured questions** (booking software as a choice, a "no Facebook page" tick, a revenue
    currency line, appointment length in minutes, a service-area picker, services and FAQs as rows). Recommended: not
    before go-live; revisit with 4 to 6 weeks of version-2 answers.
  - **CEO-5: decided 2026-11-02, "Yes and sync it in the ass as well", read as "the ads" (B1 writer, B5 `20261103f`,
    B6 `20261103e`; 4.21).** The question as it was put: **the kickoff daily budget.** Recommended then: a structured
    amount and currency on the kickoff sheet, printed `<amount> <CUR>` on Make's `Daily ad budget:` line, in place before
    the first native kickoff; never write the card's Daily Budget `539743c2`. Built: that, plus the media buyers' chain
    and an empty-only fill of Daily Budget in dollars (the reading taken by default on 2026-11-03 under the stop-asking
    rule; the CEO hears it after). Still open: the BHD and OMR rates, and the media lead's per-campaign or all-ads
    answer for the hint.
  - **CEO-6, decided 2026-11-02: "Should already be synced, if not do it fully now"** (build B3, `20261103g`, 4.19; the
    screens are build B7). It was not synced; B3 ties every sale by an exact phone or email, never a name, and fills
    the two fields only where empty on cards on the books. Taken with the defaults (stop-asking rule, reported after):
    fill on-the-books cards only, and the Sales Meeting Link yes (behind `forms.sale_tie.salesLink`). Still his: reading
    the dry run before `on`, and the one-time strip of the stored raw phone (`f322053a`) after the backfill. The
    original question, kept for the record:
  - **CEO-6: tie the New Client Form to cards** (go-live expectation on 42 of 42, handoff risks on 25 of 42; the card
    fields filled on 0 of 70). Recommended: its own workstream after go-live, tied only by an exact, unique phone or
    email with a dry-run list first, filling only empty fields, leaving Closer out.
  - **CEO-7: open kickoff items as requests** (`card_missing`, `general_tech`, `whatsapp_connection`). Recommended: not
    yet; B4 and B1 show the items; revisit after a month of notices.
  - Also for his look: the portal's new client sentence `Write a whole number, with no decimals.`
    (`اكتب الرقم بدون كسور.`), and whether on-screen Arabic numbers keep the `٬` mark (5.10).

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
| X37 | **The CEO's decision, 2026-11-02: "Yes, match Make".** For the same answers the native kickoff and onboarding write what Make 12 (`8925654`) and Make 13 (`8922994`) write, byte for byte where Make writes text. `make_parity.py`'s evaluator (X36) is the reference; `20261102o` builds Make's texts and choices in SQL (2.9). Intended entries that only described what the cockpit did differently are withdrawn (11.9); where something cannot match, 11.9 says exactly what and why, and it becomes intended only with the CEO's word (section 10) | The CEO decided it on the differences of 11.8. The evaluator equals the comments ClickUp holds on 12 of 12 real cards, so equality with it on the stored answers is equality with Make. |
| X38 | Under X37, decided for the CEO's "match Make" on 2026-11-02 (round 3): (1) the comments that mirror Make's (the handoff, the raw answers comment and the handoff on each onboarding task) carry Make's text alone, with no `Cockpit ref` line, and are still posted exactly once: found again by the id ClickUp answered, else by their text since the step began under `commentKey`, or by the old line for a row the writer before started; every other cockpit comment keeps its marker (4.13.4). (2) The request route stays for the three tasks: its description marker is what keeps a task from being made twice, so what the route adds is recorded as cannot match (11.9) and becomes intended only with the CEO's word (section 10). (3) The Client Profile is never cut and the Stage 4 text cap goes. (4) Text is kept as typed, as Typeform hands it to Make, for the onboarding's answers and the kickoff's long texts only; every other form keeps today's folding. (5) `clickup-writeback` deploys before `20261102o` is applied (D-S4F (2)) | Make writes each of these texts as typed and posts each comment alone; the ref line was the only thing between the writer's comment and Make's. The marker in a request's task description is not Make-mirroring text, and it is the request route's only guard against a second task. A request part freezes its steps before its first write, so the order of the two deploys decides whether a part ever posts its comment. |
| X39 | **The CEO's words, 2026-11-02, after "Yes, match Make": "You can even improve what's already there with the data that you have. So you can add more if it gives us better data."** Make's output (X37) is the floor and is never changed; the better-data additions B1 to B8 (4.16) are built on top of it, each into a slot Make leaves empty, an effect of its own or a cockpit-only surface, and each registered in `make_parity.py`'s `INTENDED` with these words (`brief`, `dna_brief`, `card_facts`, and `request_route`, which makes what the request route adds to the three tasks intended, 11.9's first cannot-match row). Decided under them for the build (round 4): (1) the two briefs travel the existing details path into the task description (no new writer step), which reverses `o`'s "no details" for `onboarding_tasks` and `brand_dna_task`; each is at most 3,600 characters with a fixed header and a fixed drop order, and a type without a `details` field is named, never silent. (2) `card_facts` writes only Consultation Types, ADs Platform, Fathom, Onboarding Call Date and Company Website, only while each is empty, with an audit row for every write; never Country, Daily Budget or any other field. (3) The kickoff notice's open items are fixed labels, never typed text. (4) Typeform's typed inputs come back on the native onboarding's version 2 in place, only while it is unused, with no change of wording (B3). (5) The queue audit keeps a request part's `taskComment` as its length, and a kickoff's answers get 256 KB with a refusal by name (11.9's open rows). (6) The CEO's own questions (CEO-1 to CEO-7) are listed, not built (section 10) | The CEO asked for better data on top of Make. Rounds 1 to 3 proved the native outputs equal Make's on the 12 real stored answers, so the additions can be graded apart from Make's part by exact header, key or slot, and an addition never hides a difference in Make's part (4.15.1). The stored answers show the gaps: 14 of `KFRCXPFx`'s 36 answers reach neither task, the handoff's Drive answer is empty on 25 of 42 cards while the card has the link, all 8 kickoffs leave something open, and 26 of 42 onboardings have a wrong-kind link. |

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
- **v** For `20261102o` (then drafted as `20261102m`; 2026-11-02, X37): `schema_migrations` holds `20261102a` to `k`; of every local and remote branch only `forms-s4-fixes` holds a `20261102l` or later file (`l`; `m`, now `o`, is untracked in its worktree), and the worktree `goals-sheet` (branch `goals-sheet-1102`) holds an untracked `20261102m_goal_sheet_truth.sql`; `guard_check.py supabase/migrations '20261102m*'` (the pattern as run, before the rename; today `'20261102o*'`): `n` 6, `live` 5, `odd` `cockpit_form_stage4_build(jsonb)` (live holds `j`'s `a704e72a…`; `l` is not applied); `cockpit_settings` `stage4.templates` and `stage4.messages` are `{}` and there is no `onboarding.raw_titles` row; `cockpit_requests` has no `task_comment` column; 6 option-map rows for `bab9a58b`.
- **w** For round 3 of `20261102o` (2026-11-02, read only through `wsql.py`, counts, ids and md5s only): live md5s `cockpit_form_answers_check` `d1d8bb66…` and `cockpit_form_schema_check` `1f5d9016…` (`i`'s bodies), `cockpit_kickoff_answers_check` `8a02898f…` (`j`'s), `cockpit_form_stage4_build` `a704e72a…` (`j`'s: `l` is not applied), `cockpit_form_stage4_fields` `8c36fd1c…`; `guard_check.py supabase/migrations '20261102[lm]*'` (the pattern as run, before the rename; today `'20261102[lo]*'`): 11 rows, 10 live, the odd one the builder. `cockpit_form_versions` onboarding version 2 `md5(schema::text)` `8fa1f38dfd4307f22d0b3faec8604ce7` (published by `j`); responses onboarding 46 and kickoff 8, all version 1 (`typeform_sync`); invites for either form 0; the registry has both on `typeform` version 1, `forms.stage4` both false. `cockpit_clickup_writeback_queue`: 0 rows of kind `form` for a Stage 4 key (none the old writer started), 5 `request` rows, all delivered with `card_comment` done. `cockpit_sync_state` `clickup-writeback:forms` and `clickup-writeback:requests` read mode `apply`. No table holds a ClickUp comment body (`cockpit_csm_provider_health` keeps none). Make 13 [29]'s Kickoff Form Links on cards (`cockpit_client_onboarding.links`): 69 links, 932 parameters, 914 non-empty over 23 keys; 52 values hold an encoded line feed, 16 a double space, 26 a space before a line feed, 0 a carriage return, 0 white space at the start and 0 at the end. Make-written Client Profiles on 11 cards, cut at their fixed labels: 33 answers, 3 with a line feed, 1 with a double space, 0 with a carriage return, 0 with white space at either end. On the Mac, from the private stored answers (lengths and counts only): the longest onboarding answer per question as in 2.9 (`faqs` 2,695 the longest; none reaches 4,000), the kickoff's long texts at most 422; of the 30 stored kickoffs, 0 short-text answers hold a double space; 0 stored texts hold a carriage return or a tab, and 0 white space at either end (the cockpit's own ingestion trimmed them). Make 13 [46] in the saved blueprint sets a name, a list, an assignee and `notify_all`; its start and due dates are switched off.
- **x** For round 4 (X39, 2026-11-02, read only through `wsql.py`, counts, keys and md5s only; each builder's own reads): live `cockpit_clickup_writeback_audit()` md5 `d595491be9d1cac3e385382a2e84814a`, equal to `20261026t`'s body, grant service_role, its triggers on the queue (insert and state), runs, config and tracking runs; 0 audit rows hold a `payload.taskComment`; `cockpit_form_responses_answers_check` reads `20261102f`'s definition word for word; answer sizes: kickoff 8 rows (at most 89 bytes), onboarding 46 (at most 19,736 bytes); the onboarding's version 2 md5 `8fa1f38d…` with 0 responses and 0 invites, the registry on `typeform` version 1 for both forms. Live md5s `cockpit_form_stage4_build` `a704e72a…` (`j`'s), `cockpit_form_stage4_effects` `afa3e203…` (`j`'s), `cockpit_form_stage4_plan` `cb27a373…`, `cockpit_request_create_system` `295e9260…`, `cockpit_slack_notice_kickoff_facts` `3ecb0f63…` (`20261025n`'s); the three functions `p` replaces are owner only. `guard_check.py … '20261102[lop]*'`: 15 rows, 12 live, `odd` the builder twice and `p`'s effects (all chained, as expected). `cockpit_client_onboarding.links` keys: `drive` 67, `ghl` 65, `brand_dna` 59, `offer_sheet` 57, `market_research` 25, all https strings. `cockpit_csm_calls` kind `onboarding` source `fathom`: 10, all with https recordings. The stored kickoff setup answers are the form's option labels (yes/no as `Yes`/`No`). `cockpit_request_types` has `key`, `targets` and `fields`; neither `client_onboarding` nor `brand_dna` exists. No Creative Triage table mirrors a ClickUp card's custom field values (only `cockpit_clickup_fields.options` and the writeback queue's jsonb). `cockpit_comment_watch_items`: 158; the longest `comment_digest` prompt in `cockpit_ask_ai_jobs` is 7,985 characters, 0 over 14,000. **The letters:** `select name from supabase_migrations.schema_migrations where name like '20261102%' or name like '20261103%'` reads `20261102a` to `k`, then `20261102m_goal_sheet_truth` and `20261102n_goal_sheet_media_dedupe` (no `l`); origin/main holds both goals-sheet files (`e6c186d5`); of every local and remote branch and every worktree, only `forms-s4-fixes` holds `20261102l_stage4_no_client_data_row`, `20261102m_stage4_match_make` and `20261102n_stage4_better_data` (renamed `20261102o_stage4_match_make` and `20261102p_stage4_better_data` the same day, 11.10), and no file anywhere takes `20261102o` or later, or `20261103`. Read again at the rename (2026-11-02): live still holds `20261102a` to `k`, then the goals sheet's `m` and `n`, and no live row, origin/main file, branch or worktree takes `20261102o`, `20261102p` or `20261103`.

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
`20261102o` (2.9) and the comment on each onboarding task; the last row cannot match and waits on his word (11.9,
section 10). The table is kept as found.

Two more things blocked the canaries, not the parity run. Both are fixed on the branch (11.9) and deploy at
D-S4F (6):

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
- Typeform hands Make every text as typed except at its ends: each line break a line feed, no white space at
  either end, every line break and repeated space between kept. Make 13 [29]'s links carry 914 answers as
  Typeform handed them, 52 with a line feed, 16 with a double space, 26 with a space before a line feed, and none
  with a carriage return or white space at either end; Make's Client Profiles on 11 cards agree (11.2-w). The
  stored answers cannot show the trimming themselves, because the cockpit's own ingestion trimmed them.

**What changed on the branch** (`20261102o`, 2.9; `cockpit-forms-api`; the client-success cockpit; in round 3 also
`clickup-writeback`, 4.13.4, and `make_parity.py`, 4.15.1):

| Effect | Before (`l`) | Now |
|---|---|---|
| `handoff_comment` (Make 12 [11]) | `stage4.templates.handoff` (empty live), else the cockpit's own `KICKOFF HANDOFF for …` text; a template could not write `Not provided` and listed choices in the form's order | Make's 110 lines in SQL: `Not provided` for an empty hidden value or answer, `Yes`/`No` by `switch`, Payment Amount 0 `Not provided`, lists as ticked |
| kickoff hidden values (Make 13 [29]'s link) | trimmed answers, the appointment types joined with `, ` in the form's option order, a revenue of 0 as `0`, the business name falling back to the card's name | the link's values: as stored, `,` in the order ticked, 0 empty, no fallback |
| `card_fields` `bab9a58b` Service Advertised (Make 12 [21]) | the first listed option the map knows, the list in the form's option order | the option ticked first, nothing when that one is not an option |
| `onboarding_tasks` (Make 12 [17][18], [22][23]) | `left(handoff, 4000)` as each task's description | the whole handoff as `comment_text`, kept on `task_comment` and each part's `taskComment`, posted once on each task, Make's text alone, by the request writer's `task_comment` step; the plan carries no details (round 2's stopgap description is gone) |
| `handoff_comment`, `raw_answers_comment` as ClickUp receives them | the text, a blank line and `Cockpit ref F-<10 hex>`, found again by that line | Make's text alone; found again by the id ClickUp answered, else by the text since the step began (`commentKey`), or by the old line for a row the writer before this one started (4.13.4) |
| `raw_answers_comment` (Make 13 [47]) | `Raw Onboarding Form Answers` and `title: value` lines with the shorter stored titles; a 0 as `0` | `**Raw Onboarding Form Answers**`, then `**<full title>**`, the answer and a blank line per answered question in `KFRCXPFx`'s order; 0 blank; titles from `onboarding.raw_titles`, the effect missing with a sentence while they are not set up |
| `profile_fields` `7755485f` (Make 13 [29]) | `Revenue last year: …` from the template or the cockpit's text, cut at 5,000 characters, and `clickup-writeback` refused a Stage 4 text over 5,000 UTF-16 units | Make's seven labels, each kept when empty, 0 blank, never cut; the writer takes a Stage 4 text or link of any length |
| `github_dispatch` client name (Make 13 [25]) | the card's name (billing account, then the response's) | the typed Business Name (`514bfd3f`) as typed, or an empty text |
| `brand_dna_task` (Make 13 [46]) | the raw answers text as the request's details | no details |
| `read_model` | a native list in the form's option order | in the order ticked, as a Typeform answer is |
| kickoff questions | 41; Post call form filled was free text; `whatsappAdd` a text | 46 with `tG7dnxBn`'s five follow-ups; Post call form filled is Yes or No; `whatsappAdd` a long text, as `tG7dnxBn` asks it |
| a native answer's text | `cockpit_form_answers_check` (`i`) folded every run of white space to one space in every client form's text and long text; the kickoff check folded a short text and trimmed only spaces from a long one's ends | the client onboarding keeps each text as Typeform hands it to Make (`cockpit_form_typeform_text`); the kickoff keeps a long text so and folds a short one; every other client form folds as before |
| the onboarding's version 2 | `address`, `hours`, `landmark` and `appointmentLength` short texts; every text 200 characters, every long text 2,000, so four questions would have refused a real `KFRCXPFx` answer | those four long texts, as `KFRCXPFx` asks them; every text 1,000 and every long text 10,000, so no stored answer would be refused; changed in place while unused, guarded (2.9) |
| Messages card | `recap.approve` demanded Make's booking block, so no phase draft could be approved; the counter read `/ 4,096` | a phase text is checked as `cockpit_client_message_approve` checks it (not empty, 1,500 characters at most counted as characters, the client text rule), with no placeholder but `{content_folder}` and that one once at most; approved with its exact bytes' sha256 and no warnings; the counter reads `/ 1,500` and turns red past it |
| the kickoff sheet | its own keys (26 differed from the database's list), three questions missing, every list joined into one text; a refused send still showed `Sent.` with nothing stored | the database's 46 questions with their keys, refs, options and limits; `tG7dnxBn`'s required flags and logic; lists in the order ticked; a refused send stores nothing and says what to fix in each answer; a long text sent as typed (`typeformText`), `whatsappAdd` up to 4,000 characters (5.13) |
| the forms editor's Longest answer | clamped every form at 200 and 2,000, so an edit would have cut the onboarding's new limits | `maxLengthCap` mirrors `cockpit_form_schema_check`: the onboarding 1,000 and 10,000, every other form 200 and 2,000 |
| `make_parity.py` | `TASK_COMMENT_STEP` `None`, so `onboarding_tasks` read `nothing posts comment_text on the two tasks` | `TASK_COMMENT_STEP` `task_comment`; `REF_LINE` (the comments posted with a ref line) empty; `test_make_parity.py` reads both from the writer's source (4.15.1) |

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
- The 5,000-character cut of the Client Profile and the handoff in the onboarding tasks' description: round 2
  kept both as stopgaps; round 3 dropped both with the writer changes that made them unneeded.
- The writer's `Cockpit ref F-…` line after the handoff and raw answers comments (round 2 listed it as cannot
  match): the comments are Make's text alone, still posted exactly once (4.13.4).

These stay intended, because they come from decisions: the Blueprint link (PV), the kickoff link (X15), the
phase drafts waiting for the CSM's approval (X18), one task each per card, the kickoff notice, New MRR (Q21),
the recap staying off (Q22) and the read model (the cockpit's own record).

**The oracle runs** (4.15.5, 2026-11-02, on 7 kickoffs and 5 onboarding answers). Without `o`: the five
differences of 11.8 and the onboarding tasks (7 of 7). With round 2's `o`: onboarding `PASS`, 5 runs, the dispatch, the
Client Profile and the raw comment equal byte for byte; kickoff, every effect equal or intended on 7 of 7 with
hidden values from Make 13 [29]'s link and through `cockpit_form_stage4_hidden`, except `onboarding_tasks
differs: nothing posts comment_text on the two tasks; the cockpit writes a task description Make does not`
(below; `FAIL`, 7 runs, 7 differences, in both passes). The plan's `comment_text` equals [18] and [23] on 7 of 7
(3,769 to 4,656 characters), `cockpit_form_stage4_hidden` equals Make 13 [29]'s link on 7 of 7, and
`onboarding_tasks_runner` is equal.

**Round 3** (2026-11-02, the chain `j`, `l`, `o` with the deploy settings filled; `o`'s builder measured
`a565db2d…`, its stated after md5, at the final integration run): kickoff `PASS`, 7 runs, 0 differences, with hidden values from Make 13 [29]'s
link and again through `cockpit_form_stage4_hidden` (equal to the link on 7 of 7); `onboarding_tasks` equal on
every run, graded against the writer itself (`TASK_COMMENT_STEP` `task_comment`, `REF_LINE` empty;
`test_make_parity.py` with `MAKE_PARITY_SAVED_DIR` 33 OK), and `onboarding_tasks_runner` equal: 7 of 7 requests made
with 2 parts, each part's `taskComment` the handoff byte for byte and no handoff line anywhere else. Onboarding
`PASS`, 5 runs, 0 differences. The native store `PASS`: 46 real answers on definition version 2, 1,414 texts
(116 with a line break, 27 more with a double space; none with white space at either end or a carriage return,
as stored); the answers check and `cockpit_form_store_answer` each kept 1,414 of 1,414 byte for byte, 46 of 46
stored, none folded, changed or refused (placeholders for blank required answers in older responses: `address` 9,
`projectsDone` 12, `landmark` 3, never compared). 12 answers planned, 0 refused. The full output stays in the
private folder (307 lines, ids, counts and verdicts only, 0 `differs`, 4 `PASS`, 0 `FAIL`; the same before and
after the final integration's fixes).

**Closed in round 3** (open on the branch after round 2; each landed with its tests):

| What was open | How it closed |
|---|---|
| Nothing posted the onboarding tasks' comment | `requests.ts` has the `task_comment` step between `request_type` and `card_comment`, posting `taskComment` once, Make's text alone, found again by id else by text (4.13.4); `20261102o` dropped `details` from the `onboarding_tasks` plan (builder after `a565db2d…`); `make_parity.py`'s `TASK_COMMENT_STEP` is `task_comment`. Ship order: the writer deploys before `o` is applied (D-S4F (2)) |
| A Stage 4 text field over 5,000 characters was refused | `forms.ts` checks only a value's kind and, for a link, `https`; `o` writes the Client Profile whole. A value ClickUp itself refuses is reported like any refusal (no ClickUp cap on a text field is known; real profiles are 352 to 1,233 characters) |
| A native answer lost its line breaks | `cockpit_form_typeform_text`; the onboarding's answers check and the kickoff's long texts keep what was typed; the four onboarding questions and `whatsappAdd` are long texts; the onboarding's version 2 takes 1,000 and 10,000 characters; the kickoff sheet sends long texts as typed and allows 4,000 for `whatsappAdd`; the forms editor's cap follows the schema check (2.9, 3.6, 5.13) |
| The ref line after every Stage 4 comment (listed as cannot match) | dropped under "match Make": Make's text alone, exactly once by id, else by text (4.13.4) |
| An answer at `o`'s new limits could overflow one effect's plan (128 KB), and a plan too large stopped the whole planner | `cockpit_form_effects_plan_check` lets a `kickoff` or `onboarding` plan hold 2 MB, and the planner keeps a plan that still does not fit as its lines and fails that one effect with a plain reason (2.9); the request writer takes a `taskComment` up to the same 2,097,152 units (4.13.4), so no handoff the cockpit plans fails its part. Two PGlite cases run the chain at the limits and past 2 MB |
| Docs outside these files | `docs/requests/CONTRACT.md` 4.3 has the `task_comment` row (step 8) and 2.6 the `taskComment` key; `RUNBOOK.md` names the task comment as the one request write without a marker, its 1-1 notes `unknown` row and the guardian's two queue sentences (`checks/queues.py`) say how to find a Stage 4 comment without a ref |

**Still open** (none is on this branch's code; each says when it must be done):

| What | Where | What it needs, and when |
|---|---|---|
| The client portal would undo `o` for the onboarding | Outside this repo: the portal (worktree `portal-w34`, branch `forms-w56`, the code the waves 5-6 release recorded). `src/lib/client-form-schema.ts:43` folds every string answer (white space runs to one space, then trimmed) before it is sent, and `:98` and `:130` measure and keep the folded text; `:42` and `:47` cap a text at 200 and a long text at 2,000 whatever the definition says; `src/lib/client-forms.ts:50` refuses a `maxLength` over 2,000, so it cannot parse `o`'s version 2 (10,000) and the form would not open; `src/lib/forms/onboarding-v2.json`, the staff preview's copy (parsed at `client-forms.ts:278`), still has the four questions as texts of 200 | A portal release (the Mac release steps) that keeps an onboarding text as `typeformText` does (`\r\n` and `\r` as a line feed, the ends trimmed, everything between as typed), takes 1,000 and 10,000 for the onboarding, and refreshes the copy. **Before D-S4O.** Applying `o` first is safe: no onboarding invite on version 2 can exist while the form is not live, and the portal shows the Typeform embed until then. `FormRenderer.tsx:215-217` already draws a long text as a text area with the definition's `maxLength`. **Round 4: built, not shipped.** Branch `forms-s4-portal` (worktree `portal-s4`, from origin/main, uncommitted) does all of this and also sends B3's inputs (numbers, https links, E.164 phones) and takes a 1 MB + 16 KB answer body (11.10). It still needs a commit, a PR, CI and the portal release steps, before D-S4O |
| The queue audit copies the handoff | `cockpit_clickup_writeback_audit` (`20261026t`) copies each queue row's whole payload into `cockpit_audit_log` on insert and on every state change, and leaves out only a `task_action` row's `text`. A request part's `taskComment` (the whole handoff, with the client's answers) is copied there on each change. `o` keeps it out of the `cockpit_requests` audit row, and a Stage 4 `form` row carries only its comment's length and sha256 (the writer reads the text from the effect's plan), but the request writer reads `taskComment` from the payload itself; a `profile_fields` row's `fields` also hold the Client Profile text | **Closed in round 4** for the handoff: `o` replaces the trigger function so a queue row's `taskComment` is kept as `taskCommentChars`, before and after (2.9; live 2026-11-02: 0 audit rows held one). A `profile_fields` row's Client Profile text (the revenue and goal lines, challenges, notes; no contact field) is still audited whole, as before: left as it is, not decided |
| `commentKey` rests on the repo's evidence | No production table holds a ClickUp comment body, so the read-back rule (4.13.4) was proven on `make_parity.py`'s fidelity reads, `holdsMarker`'s escape note and `cockpit-csm-api`'s plain-text read-back, not on a live task comment | **At D-S4K:** compare each canary task comment ClickUp returns with the handoff under `commentKey` (booleans only). If it differs, the writer's rule is fixed on a branch before the go-live |

**Cannot match** (the parity run reads the plan, so it grades none of these except a planned task
description; each says why, and each waits on the CEO's word to become intended, section 10):

| What | Why |
|---|---|
| What the request route adds to the three tasks | Make 12 [17] and [22] set only a name, a list and a template; Make 13 [46] a name, a list and one fixed assignee, with its start and due dates switched off and no fields or description (11.2-w). Through requests the cockpit always rewrites the description as the template's text, a rule, the request's own lines (who asked and when, the client card and request links) and its marker `Cockpit ref R-<10 hex>-<part>`, and adds a due date (`due_days` NOT NULL), a priority, owners by rule on the onboarding tasks, the client tag, the Request Type field and a link comment on the client card per task. The marker is what keeps a task from being made twice, and the rest is what every request gives its task, so the route stays (X38). Matching would mean making these tasks with direct ClickUp writes instead of requests. The task name `{client} - {type label}` and one task each per card are read as intended by `make_parity.py`. The comment Make posts on each task now matches (4.13.4). **Intended since X39** (the CEO's later words): `make_parity.py` records it as `request_route` (4.15.1), so this row no longer waits on him |
| The phase 3 map and message per Client Data row | Make 13 [31] is a search with no limit that gates [49] to [48], so Make moves the map and sends the phase 3 text once per row found: never for a card with no row, twice (to each row's group) for a card with two. The planner cannot read Client Data (no Google key in the database), so it moves the map once either way, and client-messages sends only for a card with exactly one row, on purpose. Not changed by `o`; the parity run cannot show it (the evaluator returns one row). An intended entry needs the CEO's word |
| A Business Name holding `"`, `\` or a line break | Make 13 [25] pastes it into its JSON body unescaped, so Make's request is invalid and fails; the relay sends it escaped. Matching would copy the failure |

**Latent, left as they are** (no stored answer has one):

- A kickoff with most of its long texts near their 4,000 characters in Arabic (two bytes a character): the store
  caps a kickoff answer at 64 KB (`20261102f`), which about eight such texts pass, so `cockpit_kickoff_submit`
  refuses with the table's error (23514) instead of a sentence. `j` had eleven long texts; `o` makes `whatsappAdd`
  the twelfth. The longest stored kickoff long text is 422 characters. **Closed in round 4:** a kickoff's answers
  get 256 KB, and past it the check refuses by name (`_answers: too_large`), never the table's error (2.9).
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
- A kickoff short text with a double space: the kickoff check still folds a short text, as decided, where Make
  would keep the double space. 0 of the 30 stored kickoffs' short-text answers hold one, and Typeform's short
  text holds no line break.
- `KFRCXPFx` asks `serviceFocus` as a short text, and `j` made it a long text natively, so a native answer can
  hold a line break that Typeform's short text cannot. The native phone fields were free text, where Typeform's
  `phone_number` hands Make a number Typeform normalized: **closed in round 4** (B3: stored as E.164, 2.9).
- The fold that every other form and the kickoff's short texts still use (`regexp_replace(…, '\s+', ' ')`) reads
  non-ASCII spaces such as U+3000 by the database locale (C in PGlite, `en_US.UTF-8` in production), as before
  `o`. `cockpit_form_typeform_text` names its characters as ASCII escapes, so it does not depend on the locale.

### 11.10 Better data (X39), round 4, 2026-11-02: what changed, the proof, what is open

The CEO's words, after "Yes, match Make": "You can even improve what's already there with the data that you have. So
you can add more if it gives us better data." Make's output stays the floor; every addition sits on top of it (4.16).

**What changed on the branches** (none of it committed, applied or deployed):

| Piece | Where | Section |
|---|---|---|
| Typeform's typed inputs on the native onboarding (B3), the queue audit keeping `taskComment` as its length, 256 KB for a kickoff's answers with `_answers: too_large` | `20261102o` (edited in place, still unapplied) and `stage4-match-make-supabase.test.ts` | 2.9, 3.6 |
| The two cockpit briefs (B1, B2), `card_facts` (B8) in both version-2 arrays, the notice's `openItems` (B4), the registry move | `20261102p` (new), `stage4-better-data-supabase.test.ts` (new), `stage4-native-supabase.test.ts` (`p` in its chain) | 2.10, 4.13, 4.14, 4.15.2 |
| The `card_facts` writer: allowlist, plan check, write-only-when-empty, receipts without values, the doctor's field checks | `clickup-writeback` `forms.ts`, `forms.test.ts` (`requests.ts`, `run.ts`, `index.ts` unchanged) | 4.13.4 |
| The notice's `Still open from the kickoff` line (B4); the kickoff comment read to 16,000 characters (B7) | `cockpit-notices` `text.ts` and tests, README; `comment-watch` `watch.ts` and test | 4.16 |
| The kickoff rail's Check with the client and the card's Drive folder (B5); the CSM brief's assumed currency (B6) | `formRail.ts`, `FormPanel.tsx`, `clientBrief.ts` and their tests | 4.16, 5.15 |
| One verdict per effect, `INTENDED` `request_route`, `brief`, `dna_brief`, `card_facts` under the CEO's words, the brief slots, the dropped-brief check, the `card_facts` and dispatch rules | `make_parity.py`, `test_make_parity.py`; the private harness | 4.15.1, 4.15.5 |
| The portal: the onboarding's typed text, limits from the definition, revenues as numbers, links with `https://`, phones as E.164, the copy at `o`'s md5, a 1 MB + 16 KB answer body | portal branch `forms-s4-portal` (worktree `portal-s4`); portal `docs/CLIENT-FORMS.md` | 3.6, 11.9 |

**The proof** (the official oracle run on the Mac by the one designated agent, 2026-11-02, chain `j`, `l`, `o`, `p`;
counts, ids and verdicts only; the output stays in the private folder): 12 answers planned, 0 refused. Kickoff `PASS`,
7 runs, 0 differences, on both hidden-value passes (`cockpit_form_stage4_hidden` equal to Make 13 [29]'s link on 7 of 7);
`onboarding_tasks` `equal + intended: task_name, dedupe, request_route, brief`, `card_facts` `intended: card_facts (receipt not read)`, and
the runner equal (each request's two parts carry the handoff whole as `taskComment`, and the brief reaches both parts'
descriptions whole). Onboarding `PASS`, 5 runs, 0 differences; `brand_dna_task` `equal + intended: task_name, dedupe,
request_route, dna_brief`, its runner equal. Delivery: 7 of 7 kickoff requests carry `comment_text` whole as
`taskComment` on every part; 12 of 12 registered briefs reach every part's description whole. Additions: kickoff
briefs median 2,256 and longest 3,386 characters (7), `card_facts` planned `45fdd2ea` 7, `ee9bf855` 7, `2de15aa5` 5,
`abaa31ee` 4 (the final run after the review: one stored call placed by a name match no longer counts, 2.10); Brand DNA briefs median 1,754 and longest 2,279 (5), `5d57fdde` planned on 4; dispatch keys `client`,
`taskId` only. Native store `PASS`: 46 real answers on version 2, 1,276 texts kept byte for byte by the check and the
store (116 with a line break), 138 numbers kept by both, 0 refused (placeholders for blank required answers in older
responses, never compared: `address` 9, `landmark` 3, `projectsDone` 12). Contracts `PASS`: 11 of 11 planned
`card_facts` pass the writer's own plan check (one answer with no field was skipped, not queued); 7 kickoffs give 31
open items, all named by `cockpit-notices`, 0 counted as unknown, and the SQL's 26 options and 3 fixed phrases agree
with `text.ts`; 0 runs hold a contact answer in a new text; the portal's version-2 copy equals the database's
(`bc89ca36`), 256 of 256 synthetic phone, link and revenue answers get the same refusal or stored value from the
portal and `cockpit_form_answers_check`, and 34 of 34 raw phones read the same. The VPS run at D-S4F stays the proof of
record.

**Open** (each says when it must be done):

| What | Where | What it needs, and when |
|---|---|---|
| The portal release | portal branch `forms-s4-portal`, uncommitted (`npm test` 1,967, typecheck clean; `npm run build` not run locally) | Commit, PR, CI, the portal release steps (`docs/CURRENT-STATE.md`, `AGENTS.md`: deploy, the 17 live origin checks, a release receipt). Both it and `o` must be live **before the first native onboarding invite (D-S4O)**; their order does not matter (the new reader also parses `j`'s live version 2) |
| CEO-1: where the market intel job reads the answers | section 10 | **Urgent, before D-S4O**: if the job reads Typeform, a portal-native onboarding gives it nothing |
| The request types' `details` field | D-S4F (9) | Seed `client_onboarding` and `brand_dna` each with `{key: 'details', kind: 'details'}`, or the briefs stay out of the tasks (named, never silent). **At D-S4F** |
| Ship order | D-S4F (2), (3b) | `clickup-writeback` with `card_facts` live before `p` is applied, or a canary's `card_facts` row fails as a mismatch. `cockpit-notices` in either order |
| A labels field's read-back on live ClickUp | `forms.ts` reads a labels value as an array of option ids (objects with an id tolerated); no live card was read (no mirror holds card field values) | The D-S4K canary reads it back on the test card; if ClickUp returns another shape, fix the reader on a branch before the go-live |
| The option ids | `CARD_FACTS` (the s40 snapshot) | The forms doctor with `kickoff` (D-S4K) or `onboarding` (D-S4O) in the keys reads them live; a renamed or removed option fails its row with no write |
| The CSM lead | `card_facts` can fill an empty Onboarding Call Date, which moves `csmCadence` | Tell the CSM lead **before D-S4K** |
| A specific sentence for `_answers: too_large` | `kickoffRefused` (`kickoff.ts`) has no case; the generic "Tell the tech lead" sentence shows (5.13) | Optional: a 2-3 line branch. Only control characters can trigger it |
| The rail's look | `CheckPart` is proven by static markup only; the form harness has no flagged state | A 375px and dark-mode look in the browser |
| The billing country for B6 | `clientBrief.ts` takes `billingCountry`, but the client page does not read billing, so no caller passes it; the phone code is what runs (on the stored answers, the same shown currency on 29 of 29 cards with a billing country) | Pass it only if the client page loads billing for another reason |
| `docs/csm-forms/KICKOFF.md` section 3 | It lists the rail's parts without Check with the client or the Drive fallback | Add both lines (not in this round's files) |
| The digest's headroom | `watch.ts` now cuts kind `kickoff` at 16,000, so its prompt is no longer the Convex prompt word for word; about 12,000 of the 30,000-character record limit stay for the Do's & Don'ts field, whose real length no mirror holds | Watch the first long kickoff digest |
| The portal's decisions log | The portal's `AGENTS.md` asks for durable decisions in mahara-context `context/DECISIONS.md` | Two entries proposed (outside these repos' files): the portal keeps the onboarding's text as typed and sends phones as E.164 and links with `https://`; the form answer body cap is 1 MB + 16 KB |
| The Client Profile text in the audit | a `profile_fields` queue row's `fields` hold the Client Profile text, still audited whole (11.9) | Left as it is; no contact field is in it |
| Coupling | the portal mirrors `o`'s version 2, phone set, caps and `typeformText`; `p` stands on `o`'s builder | If `o`'s version-2 transform changes, move the portal copy, the portal's and the cockpit's `V2_M_MD5` together; if `o`'s builder changes, rebase `p`'s builder, its `a565…` constant (file and test) and its after md5s. Since `20261103b` (4.18) version 2 is `38d371cd…` (`V2_B_MD5` beside `V2_M_MD5`, which stays as history): the portal's copy moves to it in P1, and a later change to version 2 in place moves both again, or goes into version 3 |
| Cosmetic | the drift guard's message for the audit trigger says `changed since 20261102l`; its baseline is `20261026t`'s body | None: the guard itself works |

Closed after the review: the native test that failed on the Typeform door's revenues passes unchanged (the door
stores numbers, `o` item 16; 43 of 43), and `make_parity.py` reads the writer's own `card_facts` receipt (4.15.1;
`(receipt not read)` until the D-S4K canary). Checked and not open: `slack-notices-supabase.test.ts` reads `20261025n_slack_notices.sql`'s facts function, not `p`'s,
so its `toEqual` on the facts needs no `openItems`. A re-apply of `l` by hand after `p` while a go-live is on stops in
`l`'s registry step; the normal order `l`, `o`, `p` is not affected (2.10).

**Closed at the rename (2026-11-02).** The migration letters: live and origin/main took `20261102m` and `20261102n`
for the goals sheet (11.2-x), so this branch's `m` and `n` were renamed `20261102o_stage4_match_make.sql` and
`20261102p_stage4_better_data.sql` (2.1); `l` was free and kept its letter, and the block stays in order (`l`, `o`,
`p`). The rename moved the files, the SQL's messages and audit actors (`Apply 20261102l before 20261102o.`,
`Apply 20261102o before 20261102p.`, `changed since 20261102o`, `migration 20261102o`, `migration 20261102p`), the
three Stage 4 PGlite chains, `test_make_parity.py`'s glob (now the full stem `20261102p_stage4_better_data.sql`, so
it never matches the goals sheet's `n` once main is merged), `make_parity.py`'s comments, the private harness (full
stems; `run.sh --without-o` and `--without-p`) and these docs. No function body changed (comments inside them still
name `20261102m` or `20261102n`), so every after md5 stands, `a565db2d…` included.

**Limits, stated:** ClickUp has no compare-and-set, so a value another writer sets between `card_facts`' read and its
POST, when the POST lands last, is overwritten unseen; the receipt still truly says `empty`, and the window is one
paced call. A value that lands after the write is seen and kept.
