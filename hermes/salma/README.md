# Salma — the social media producer

An agent on the Hermes VPS that turns a month and a pillar mix into a
written plan, then into captions and images. Lives at
`/opt/data/bibi/agents/salma/` beside the other agents and follows their
convention: `SOUL.md`, `USER.md`, `TOOLS.md`, `AGENTS.md`, `MEMORY.md`,
`memory/YYYY-MM-DD.md`.

This directory is the version-controlled copy. Deploy with:

```
scp hermes/salma/*.md hermes/salma/salma.py hermes@187.77.156.166:/opt/data/bibi/agents/salma/
```

## Why it is here and not in the cockpit

Images come off Mahara's existing Higgsfield subscription through its
**MCP**, and a Convex action cannot call an MCP tool. That one constraint
is why generation lives on a machine that can. The cockpit writes a job;
Salma drains it.

## What runs

`salma.py` drains `social_jobs`:

| kind | who does it | where |
| --- | --- | --- |
| `plan` | DeepSeek — extraction and drafting, per the routing rule | here |
| `caption` | Anthropic, or OpenAI if that key is missing. Never the cheap model: a client's dialect is judgment | here |
| `generate` | Higgsfield MCP | **not here** — deferred back to the queue for the openclaw agent session |

`generate` raises `Deferred`, which puts the job back to `queued` rather
than failing it. A queue read by people needs `failed` to mean something
went wrong.

## Two memories, kept apart

- **`social_bank`** in Supabase is the *client's* memory: what their
  audience asks, and every correction on their work. Staff see and edit it.
- **`MEMORY.md`** here is *craft* memory: what works across clients. Only
  patterns seen on more than one client.

A correction about Ardon goes in Ardon's bank. A lesson about how to open
an Education post goes in `MEMORY.md`. Collapsing the two is how an agent
gets confidently wrong.

## Proved on 2026-09-19

Against Qatar Technology, a real client with a 16,500-character brand
guide and six real audience questions:

- twelve posts planned, four per pillar, all four Education topics taken
  from the client's own bank rather than invented, two of them verbatim in
  Arabic;
- captions written in Gulf Arabic, naming Schuco, Technal and Alumil --
  checked afterwards and all three are in the client's brand documents, so
  transliterated rather than invented;
- the em-dash guard fired on a caption the model wrote with one anyway.

## What it will not do

No GoHighLevel credentials are in this process and none should be added.
Posting is the cockpit's; publishing is GHL's. Salma writes `social_posts`
and her own memory, and never moves a batch — moving one is a decision.
