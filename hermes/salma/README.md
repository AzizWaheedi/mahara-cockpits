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
| `caption` | **OpenAI (`gpt-4.1`)** today. Anthropic if that key is ever set. Never the cheap model: a client's dialect is judgment | here |
| `generate` | Higgsfield MCP | **not here** — deferred back to the queue for the openclaw agent session |

**`generate` writes the prompts first, then makes the pictures.** The
prompts are saved before a single image is requested, so a generation
that fails half way leaves the reviewable half behind and re-running
costs only the images.

Higgsfield's REST API, not its MCP: `POST /v1/text2image/soul` at
`platform.higgsfield.ai`, authenticated `Authorization: Key <id>:<secret>`
from `HIGGSFIELD_ID` and `HIGGSFIELD_SECRET`. The schema was read off the
API's own 422s on 2026-09-20 because the published docs do not carry it:
`params.prompt` and `params.width_and_height` are required, the size is
one of sixteen fixed strings, `quality` is `720p` or `1080p` and
`batch_size` is 1 or 4. It answers with a job set to poll.

Two things that will bite anyone reading this later. Higgsfield sits
behind **the same Cloudflare bot rule GoHighLevel does** -- a default
urllib agent is refused 403 at the edge before the API sees it, so the
browser User-Agent is load-bearing. And an empty balance is a **403 with
"Not enough credits"**, which is not a bug and not retryable; it raises
`NoCredits` so the queue says "top up" rather than "investigate".

Every finished image is **copied into our own `social-images` bucket**
rather than linked where Higgsfield put it. Their URLs are theirs and
need not outlive the job, and GoHighLevel fetches media when it
publishes, which can be days later -- so a post pointing at somebody
else's temporary URL is a picture that disappears between approval and
posting. The bucket is public for that reason and holds nothing private.

Slides are square. Every slide of a carousel has to share one aspect
ratio, and a square is the one that never crops badly.

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
- captions written in Gulf Arabic by `gpt-4.1`, naming Schuco, Technal and
  Alumil -- checked afterwards and all three are in the client's brand
  documents, so transliterated rather than invented;
- the em-dash guard fired on a caption the model wrote with one anyway.

## What it will not do

No GoHighLevel credentials are in this process and none should be added.
Posting is the cockpit's; publishing is GHL's. Salma writes `social_posts`
and her own memory, and never moves a batch — moving one is a decision.

## Why not Higgsfield for the words

Higgsfield makes pictures. A caption is text, and Higgsfield has no text
model to call -- the two jobs are not interchangeable and no single tool
does both.

The words come from a language model, and that is already settled:
`gpt-4.1` writes the captions on the OpenAI key the box already has, and
the plans go to DeepSeek. **Nothing is missing and nothing is waiting on a
new subscription.** The Anthropic branch is there only because the
variable exists on the box and is empty; if a key ever lands in it,
captions move over and the job result records which model wrote each one,
so it is never a silent change.
