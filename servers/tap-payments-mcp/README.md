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
confirmation step is `src/server.ts`'s `tap_create_charge` and
`tap_create_refund` handlers (shared by both the stdio and HTTP
entrypoints).

## Deployment modes

Two ways to run this, pick one per client (or mix):

| | **stdio** (`src/index.ts`) | **HTTP** (`src/http.ts`) |
|---|---|---|
| Who spawns it | Each MCP client spawns its own local process | You run it once, everyone connects to the same URL |
| Where it runs | Wherever the client is (your Mac, this box, etc.) | One shared place — Aziz's choice: this VPS |
| Auth | None needed — the client that spawned it already has the Tap key in its own env | `MCP_BEARER_TOKEN` required — a separate secret from the Tap key, gating who can reach this server at all |
| Setup per client | A local command + env block, per client | One URL + one bearer token, per client |

Aziz's decision on 2026-09-20: **one shared HTTP server on the VPS**, every
LLM tool points at the same URL instead of each spawning a local process.

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

## Running the shared HTTP server

```bash
PORT=8420 \
TAP_MODE=test \
TAP_SECRET_KEY_TEST=sk_test_... \
MCP_BEARER_TOKEN=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))") \
node dist/http.js
```

- **`MCP_BEARER_TOKEN` is required.** The server refuses to start without
  it — a payments server reachable over the network with no auth at all is
  not an acceptable default. Generate a real random one, don't hand-type a
  password.
- **`GET /health`** is unauthenticated on purpose (just "is the process
  up", no Tap data) — safe for an uptime monitor to poll.
- **`POST /mcp`** is the actual MCP endpoint. Every request needs
  `Authorization: Bearer <MCP_BEARER_TOKEN>` or gets a 401.
- Stateless transport: a fresh MCP session per HTTP request, nothing held
  in memory between calls. Simpler and safer for a single-tenant payments
  tool than managing session lifecycles.

**Verified live, 2026-09-20** — this isn't a "should work," it's a real
sequence that was actually run: unauthenticated request to `/mcp` → real
401. Wrong token → real 401. Correct token → real MCP `initialize`
handshake → real `tap_retrieve_charge` call against the same live test
charge from the stdio tests (`chg_TS05A5120260638r8JT2009852`), same data
came back, over HTTP this time.

**Running it persistently:** `deploy/tap-payments-mcp.service` is a
systemd unit template. Fill in the real env values (ideally via
`EnvironmentFile=` pointing at a 600-permission file outside the repo,
never hardcoded in the unit itself), then:

```bash
sudo cp deploy/tap-payments-mcp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tap-payments-mcp
```

## Wiring an LLM tool into the shared server

**Claude Code**, via a remote MCP config (check your Claude Code version's
exact remote-server syntax — this is the general shape):
```bash
claude mcp add tap-payments --url https://your-vps-host:8420/mcp \
  --header "Authorization: Bearer <MCP_BEARER_TOKEN>"
```

**Any MCP client that supports remote/HTTP servers (generic config):**
```json
{
  "mcpServers": {
    "tap-payments": {
      "url": "https://your-vps-host:8420/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_BEARER_TOKEN>"
      }
    }
  }
}
```

Put the real VPS host and the real bearer token in place of the
placeholders. Anyone with the URL and the token can call these tools —
treat `MCP_BEARER_TOKEN` with the same care as the Tap secret key itself.

### Running a local stdio copy instead (per client, no shared server)

Still supported, for a client that can't reach the VPS or where you want
full isolation:

**Claude Code:**
```bash
claude mcp add tap-payments -- node /path/to/servers/tap-payments-mcp/dist/index.js
```

**Generic stdio config:**
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

Start in test mode everywhere it's wired, whichever deployment mode you
use. Only add `TAP_SECRET_KEY_LIVE` and flip `TAP_MODE=live` on the
specific deployment you actually want moving real money — not as a global
default.

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
