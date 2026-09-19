# Memory Core

> **⏸ PAUSED (2026-09-19).** Working code, pushed, not deployed. Do not build
> further on this until Aziz un-pauses it. See "Status" below before touching
> the Anthropic wiring — the API-key answer model is a known, intentional gap,
> not a bug to silently fix.

One search box over **Notion, Gmail and Google Drive**, plus the facts you save
yourself. Ask a question and the answer is written only from what the search
found, with a numbered citation back to every item it used.

This is Aziz's own tool, not a client-facing cockpit, and it is deliberately
narrow: **search, ask, save a memory, and see what is connected.** Voice, image
generation, the photo library and the website previewer from the source video
are separate builds and are not scaffolded here.

| View | What it does |
|---|---|
| **Search** | One box, three sources, one ranked list with a source badge and the matched text on every row |
| **Ask** | A question answered from the search results, with numbered citation chips that light up their excerpt |
| **Memories** | Save a fact by hand ("favourite colour is green") — it joins the same index, so search and answers find it too |
| **Sources** | Each connection, when it last answered, item counts, the health ledger and the audit tail |

## How it works

```
Search box / Ask
      │
      ▼
convex/search.ts  retrieveContext()
      │  1. one Composio call → Notion + Gmail + Drive in parallel
      │  2. index whatever came back (the memory grows with use)
      │  3. search the index too (saved memories + everything synced)
      ▼
ranked results ──────────────► Search screen
      │
      └─► convex/chat.ts → the answer model → grounded answer + citations
```

Three rules the code takes seriously:

- **A source that fails says so.** "Nothing in Gmail matched" and "Gmail did not
  answer" are different sentences; an empty list is never used for both.
- **No answer without a source.** Nothing relevant found means no model call at
  all, and the plain sentence *"I don't have that in your connected sources."*
  Every `[n]` an answer uses is checked against the excerpts before it is stored.
- **Every write leaves an audit row**, and every outside call leaves a health
  row, both readable on the Sources view.

## Stack

Convex (backend, index, cron) · Vite + React 19 + TypeScript · Tailwind v4 ·
Biome · Geist and the Mahara brand tokens (`--mahara-teal` `#00CFC8`,
Deep Space `#091333`, Royal Blue `#2E5BD6`) through the CEO kit's component
pattern (`SectionCard`, `StatTile`, `StatusChip`, `EmptyState`, `format.ts`).

## Running it

```bash
bun install
bunx convex dev            # backend (writes .env.local with VITE_CONVEX_URL)
bun run dev                # site
```

Or, without a watch process:

```bash
bun run sync:build         # push functions once, then build the site
bun run smoke              # walks the whole path against a deployment
```

### Deployment environment

Set with `bunx convex env set NAME value` (never in `.env.example`):

| Name | Why it is needed |
|---|---|
| `COMPOSIO_API_KEY` | The one door to Notion, Gmail and Drive (`x-consumer-api-key` against `https://connect.composio.dev/mcp`) |
| `MEMORY_CORE_ACCESS_CODE` | The access code every read and write checks **on the server**. Without it the app is closed to everyone |
| `ANTHROPIC_API_KEY` | **Do not set this.** Aziz uses the Claude subscription (OAuth), not console API-key billing — see "Status" below |
| `ANTHROPIC_MODEL` | Optional, defaults to `claude-opus-5`, only relevant once the auth question below is resolved |
| `OPENAI_API_KEY` | The fallback that writes answers when Claude is not wired |
| `OPENAI_MODEL` | Optional, defaults to `gpt-4.1-mini` |

## Status (2026-09-19)

**Paused by Aziz.** The build passed its full verification bar — typecheck,
lint, `sync:build`, a 7/7 smoke test, and live calls against real Notion,
Gmail and Drive data — but is not deployed and should not be extended further
right now.

**The open question is the answer model, and it is an auth question, not a
missing key.** `ANTHROPIC_API_KEY` was empty at build time, so `chat.ts`
currently falls back to `gpt-4.1-mini`. Aziz's instruction: **Anthropic should
authenticate the way his subscription already does (OAuth / Claude
Code-style session auth), not through a console API key** — the same reason
his personal Hermes setup runs on OAuth credentials rather than
`ANTHROPIC_API_KEY` billing. `convex/tools.ts`'s `callAnthropic()` currently
assumes a bearer API key, which is the wrong shape for that auth model and
needs to change, not just receive a value.

Before resuming: work out how a Convex **action** (a server-side, non-interactive
context — no browser, no local `claude` CLI) can call Claude under subscription
auth rather than console billing. That is a real constraint worth checking with
Aziz directly rather than guessing at a workaround, since it may mean the
answer step needs to happen through a different execution path than a plain
Convex action (for example, proxied through Hermes's own already-authenticated
session instead of a raw Anthropic API call from Convex). Do not silently swap
in `ANTHROPIC_API_KEY` to make the red state go away.

The Sources view always names the model that actually answered, and says so in
plain words when Claude is not connected.

## What each source can actually match

This is on the screen beside the results, not buried here:

- **Gmail** — full-text search over the whole message, sender and subject
  included. A very large batch comes back **shortened by Composio**; the screen
  says so on that pass, and the item link opens the whole message.
- **Google Drive** — file names and Google's own index of the file. File
  *contents* are not downloaded.
- **Notion** — page titles only. Open a page result once (the "Read in" button,
  or the first sync reads the newest three) and the page's own text joins the
  index, so from then on it matches on words inside the page.
- **Memories** — whatever you typed. Always searchable, always citable.

## Health ledger and cron

- Every Composio and model call writes a row to `memory_health`. The Sources view
  shows the last few as dots and turns **three failures in a row** into one plain
  sentence with the fix attached (see `RUNBOOK` in `convex/health.ts`).
- `convex/crons.ts` syncs the three sources daily at 04:00 UTC (07:00 Kuwait).
  It only ever adds: a sync never deletes an item.

## Access

One code, one person — there is no user table because there is no second user.
The code lives on the deployment as `MEMORY_CORE_ACCESS_CODE`; the browser keeps
it in `localStorage` and sends it with every call; `convex/gate.ts` checks it on
every read and write. This differs from the other cockpits, which sign people in
with Convex Auth and read roles from a members table because they have several
people with different jobs.

## Shipping

This app has no Convex project or Vercel project yet, so `scripts/ship.sh`
cannot ship it until both exist:

1. Create the Convex project (`bunx convex dev` while logged in, or the
   dashboard) and note the production deployment URL.
2. Set the six environment variables above on that deployment.
3. Add a `memory-core` case to `scripts/ship.sh` with that URL.
4. Create the Vercel project and deploy — `scripts/ship.sh` does
   `VITE_CONVEX_URL=<url> bun run build` then `vercel deploy --prod`.
5. Record the session in mahara-context `shared/sessions/` as the repo rules ask.
