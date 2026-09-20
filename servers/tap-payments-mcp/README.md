# Tap Payments MCP

An in-house MCP server for [Tap Payments](https://tap.company) (Kuwait/GCC).
Any MCP client — Claude Code, Hermes, Codex, Cursor, anything that speaks the
Model Context Protocol — can connect and get charges, refunds, customers, and
invoices as tools.

## Why this exists instead of an off-the-shelf one

The obvious shortcut was `mcpmarket.com/server/tap-payments`. It failed the
skill-bouncer vet: **0 GitHub stars, no visible source repository, unverified
maintainer** — not something to hand a live payments secret key to. Composio
also has no native Tap toolkit (checked live via `COMPOSIO_SEARCH_TOOLS`,
closest matches were the unrelated "Tapfiliate" and Stripe). So this is a
small, auditable server Aziz controls end to end, built directly against
Tap's own documented v2 API (`developers.tap.company`).

## Safety model — read this before setting `TAP_MODE=live`

| | `TAP_MODE=test` (default) | `TAP_MODE=live` |
|---|---|---|
| Key used | `TAP_SECRET_KEY_TEST` | `TAP_SECRET_KEY_LIVE` |
| Charges | Simulated — Tap accepts the request but no card is actually charged | **Real. Real money moves.** |
| Refunds | Simulated | **Real. Cannot be undone.** |
| Safe for "give all my LLMs access"? | Yes | Only once you've decided you want agents able to move real money — see below |

There is **no accidental path into live mode**. The server refuses to start
if the mode's required key is missing, rather than falling back silently.
Every tool call logs `mode`, tool name, timestamp and outcome to stderr, so a
live charge or refund always leaves a trail your MCP client can surface.

Aziz's own call (2026-09-20): full access including refunds, no extra
approval gate baked into the code. If that changes, the place to add a
confirmation step is `src/index.ts`'s `tap_create_charge` and
`tap_create_refund` handlers.

## Setup

```bash
cd servers/tap-payments-mcp
npm install   # or bun install
npm run build
```

Copy `.env.example` to `.env` and fill in the real keys (never commit `.env`):

```bash
cp .env.example .env
```

## Wiring into an MCP client

**Claude Code:**
```bash
claude mcp add tap-payments -- node /path/to/servers/tap-payments-mcp/dist/index.js
```

**Any MCP client (generic stdio config):**
```json
{
  "mcpServers": {
    "tap-payments": {
      "command": "node",
      "args": ["/path/to/servers/tap-payments-mcp/dist/index.js"],
      "env": {
        "TAP_MODE": "test",
        "TAP_SECRET_KEY_TEST": "sk_test_..."
      }
    }
  }
}
```

Start in test mode everywhere it's wired. Only add `TAP_SECRET_KEY_LIVE` and
flip `TAP_MODE=live` on the specific client(s) you actually want moving real
money — not as a global default.

## Tools

| Tool | Mode-sensitive? | What it does |
|---|---|---|
| `tap_create_charge` | Yes | Create a payment charge |
| `tap_retrieve_charge` | No (read-only) | Look up one charge |
| `tap_list_charges` | No (read-only) | List recent charges |
| `tap_create_refund` | Yes | Refund a charge, full or partial |
| `tap_retrieve_refund` | No (read-only) | Look up one refund |
| `tap_list_refunds` | No (read-only) | List recent refunds |
| `tap_create_customer` | Yes | Create a customer profile |
| `tap_retrieve_customer` | No (read-only) | Look up one customer |
| `tap_list_customers` | No (read-only) | List customers |
| `tap_create_invoice` | Yes | Create/send an invoice |
| `tap_retrieve_invoice` | No (read-only) | Look up one invoice |
| `tap_list_invoices` | No (read-only) | List invoices |

"Mode-sensitive" means the action is simulated in test mode and real in live
mode. Every read-only tool is safe in either mode, since it never mutates
anything.

## Verified against the real API

2026-09-20: end-to-end tested through the actual MCP protocol (JSON-RPC over
stdio), not just unit-tested in isolation.

- `tap_create_charge` created a real test-mode charge —
  `chg_TS05A5120260638r8JT2009852`, merchant id `67968604` (matches the
  account exactly), status `INITIATED`, a real Tap-hosted checkout URL
  returned.
- `tap_retrieve_charge` then read that same charge back and it matched.
- `tap_list_charges` / `tap_list_customers` correctly surfaced Tap's own
  "not found" errors on an empty test account rather than fabricating an
  empty-looking success.

One correction made during testing: **the docs page for list endpoints
(`GET /v2/charges` etc.) 404s in practice.** The real, working endpoint —
confirmed against the OpenAPI spec at
`developers.tap.company/reference/list-all-charges.md` and a live call — is
**`POST /v2/{charges,refunds,customers,invoices}/list`** with a JSON body,
not a GET with query params. The code reflects the verified behavior, not
the page that turned out to be stale.

## Credentials this server never sees

Tap also issued a goSell (legacy) merchant ID/username/password/API key pair.
This server does not use them — goSell is Tap's older, separate integration
surface (plugin/e-commerce platform credentials), not the v2 REST API this
server talks to. They are not stored here.
