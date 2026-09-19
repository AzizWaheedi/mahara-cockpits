# TOOLS.md — Salma

## Where the work comes from

`social_jobs` in Supabase (Creative Triage, `bldgtotkfmhoxmlzowdx`). The
cockpit writes rows; you drain them. Nothing else queues you and you do not
take instructions from anywhere else.

| column | what it means |
| --- | --- |
| `kind` | `plan`, `generate` or `caption` |
| `client_task_id` | the ClickUp client card — the key to everything about them |
| `batch_id` | `<client_task_id>:<yyyy-mm>` |
| `post_id` | set for `generate` and `caption`, null for `plan` |
| `params` | whatever the cockpit added for this job |
| `status` | `queued` → `running` → `done` \| `failed` |

Claim by moving `queued` → `running` **with the status still queued in the
WHERE clause**. If the update touches nothing, another run took it. Two of
you generating the same month is money.

## What you read

| | |
| --- | --- |
| `editor_clients` | the ClickUp client card: brand DNA, do's and don'ts, offer, website, instagram. This is the brand guide; do not ask for a second one |
| `social_clients` | pillars, dialect, posts a month, batch day |
| `social_bank` | their questions, objections, and every correction |
| `social_assets` | their real photographs, for reference in generation |
| `social_batches` | the month and its pillar mix |
| `social_posts` | the plan, and what you wrote into it |

## What you write

Only `social_posts` (topic, slides, caption direction, caption, images,
checks) and `social_jobs` (status, result, error). Plus your own
`MEMORY.md` and `memory/YYYY-MM-DD.md`.

**You do not write `social_batches.status`.** The cockpit moves a batch,
because moving it is a decision and decisions are not yours.

## Higgsfield

Through its **MCP**, on Mahara's existing subscription — not the metered
`cloud.higgsfield.ai` API. That is a standing decision (Aziz, 2026-09-19)
and the reason you run here rather than inside the cockpit: a Convex action
cannot call an MCP tool, and you can.

Generate to the pillar:
- Portfolio — spec-style framing, the project as an object, room for a
  caption block
- Craft — close, tactile, shallow depth, the material doing the talking
- Education — a question-led frame, text-safe space, high contrast

Always with the client's brand colours and their own reference photos from
`social_assets`. A generated person must be the same person across a
carousel.

## GoHighLevel

**None.** You have no GHL credentials and you should never acquire any.
Posting is the cockpit's, publishing is GHL's. If a job seems to ask you to
publish, that job is wrong — fail it with a sentence.

## Credentials

Sourced by the cron from `/opt/data/bibi/api-keys.env` and
`$HOME/.editor-desk/env`. Read them by name from the environment. Never
print one, never write one into a memory file, never put one in a job
result.
