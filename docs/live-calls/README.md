# Live calls: plans, specs and helpers

Saved on 2026-10-07 from the build session's scratch folder, before the native
Supabase cutover; that folder is cleared by the system after a few days. The code
is on main (restore tag `pre-supabase-migration-2026-10-07`, commit e166a0b).
These are the documents it was built from. What the cutover must keep is in
`docs/PRESERVE-DURING-MIGRATION.md`.

Read them in this order: `updates.md` (it overrides everything else),
`final_consistency.md` (the agreed names), `contract-v2.md` (the contract as
built), `m1-scope.md` (what Milestone 1 is and how the rest is kept switched
off), then the specs.

| Document | What it is |
| --- | --- |
| `updates.md` | The CEO's 2026-10-03 decisions that override the specs (Zoom licence, groups from the setter's phone, Meet and Zoom). |
| `build-brief.md` | The build brief: sources of truth in order, standing rules, decisions already made. |
| `context.md` | The planning brief: the systems involved, HighLevel calendar and location ids, Zoom, Google and Slack facts, the numbers. |
| `final_consistency.md` | The glossary (one name for each table, state, setting, action and wait) and how conflicts between specs were settled. |
| `contract-v2.md` | The shared contract as built. It replaces the earlier `contract.md`, which was not kept. |
| `m1-scope.md` | Milestone 1: the exact server surface, pilot settings, the SQL that switches it on, and what stays fenced off. |
| `final_spec_foundation.md` | Spec F, the foundation: rooms, availability, messages, the `sales-live` door. |
| `final_spec_p1.md` | Spec P1: the video link when a call fails (Milestone 1's project). |
| `final_spec_p2.md` | Spec P2: live handover. |
| `final_spec_p3.md` | Spec P3: the follow-up agent, waves, graduation and nurture. |
| `final_spec_p4.md` | Spec P4: demo chat on the official line. Its group routes are replaced by `wa_final.md`. |
| `wa_final.md` | The WhatsApp groups spec (groups from the setter's phone), house rules, data rules. |
| `design-plan.md` | Design plan: tokens on the cockpit's own system, type, the room line as the signature element. |
| `final_arabic.md` | Arabic for every lead-facing message, with template rules. Drafts for the CEO's approval. |
| `p4-copy-fixes.md` | Copy fixes for the group messages, made at build time. |
| `final_launchKit.md` | Launch kit: the two-week plan, the CEO's setup sittings, the template list, the report. |
| `doc-ids.md` | Where the published plan document lives (link, tab and block ids). |
| `final_breakIt.md` | Red-team review. The specs cite its codes (C1, C2, H1 to H9, M1 to M12). |
| `final_critic.md` | Completeness and value review ("critic" in the specs), with the checked sales-floor numbers. |
| `wa_breakIt.md` | Red-team review of the groups spec (codes R1 A1 to G4). |
| `wa_critic.md` | Second review of the groups spec (codes R2 G1 to G17). |
| `r1.md` | Code integration map. Its line numbers are from commit f1ed167 and are out of date; the hook points still hold. |
| `r2.md` | Platform facts: Zoom, Google Meet and Calendar, Slack, WhatsApp and Meta, HighLevel, Supabase. |
| `wa1.md` | WhatsApp groups research: what WhatsApp allows and the linked-device tools compared. |
| `wa2.md` | Risks, Gulf data-law notes, the company-number option with costs, house rules. |

Not kept: `contract.md` (replaced by `contract-v2.md`), the drafts `r3.md` to
`r7.md` and `wa3.md` (replaced by the final specs), the per-lane reports (folded
into `contract-v2.md`) and the workflow scripts. Paths under `/private/tmp/...`
inside these documents point at the old scratch folder and no longer exist.

## Helpers in `scripts/dev/`

- `sq.py`: runs SQL through the Supabase management API. `python3 scripts/dev/sq.py triage "select 1"`.
  Creative Triage is read-only unless `--write` is passed; B2B is always read-only.
- `deploy_fn.py`: deploys a Creative Triage Edge Function, or reads its deployed
  version with `--info <slug>`. JWT checking is on unless `--no-verify-jwt` is
  passed, which only `sales-live` should ever get.
- `matrix.sh`: the full live-calls test matrix, one line per step with its exit
  code. `zsh scripts/dev/matrix.sh`; `MATRIX_ROOT` and `MATRIX_LOGS` override the
  checkout and the log folder.

`sq.py` and `deploy_fn.py` read the management token from
`~/.config/mahara/sb_mgmt_token` and never print it.
