#!/usr/bin/env node
/**
 * Tap Payments MCP server — STDIO entrypoint (local, one process per client).
 *
 * Built in-house 2026-09-20 after the third-party mcpmarket.com listing
 * failed vetting: 0 GitHub stars, no visible source repository, unverified
 * maintainer — not something to hand a live payments secret key to. This
 * server holds the key itself, on infrastructure Aziz controls.
 *
 * There is also an HTTP entrypoint (src/http.ts) for running this as one
 * shared server other MCP clients connect to over the network, instead of
 * spawning a local process per tool. See README.md "Deployment modes".
 *
 * SAFETY MODEL — read before wiring in the live key:
 *
 *   TAP_MODE=test (default)  -> only the test secret key is ever used, even
 *                                if a live key is present in env. Every
 *                                write actually happens against Tap's test
 *                                mode: charges are simulated, nothing real
 *                                moves. This is the safe default for "all my
 *                                LLMs have access".
 *   TAP_MODE=live             -> uses the live secret key. Real charges,
 *                                real refunds, real money. Must be set
 *                                explicitly; there is no accidental path
 *                                into live mode.
 *
 * Env vars:
 *   TAP_SECRET_KEY_TEST   required for test mode (default)
 *   TAP_SECRET_KEY_LIVE   required only when TAP_MODE=live
 *   TAP_MODE              "test" | "live", defaults to "test"
 *
 * Every tool call is logged (mode, tool name, timestamp, outcome) to stderr,
 * which MCP clients typically capture — so a live-mode charge or refund
 * always leaves a visible trail, not a silent action.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTapMcpServer, resolveConfig, type TapClientConfig } from "./server.js";

let config: TapClientConfig;
try {
  config = resolveConfig();
} catch (err) {
  console.error(`[tap-mcp] ${err instanceof Error ? err.message : String(err)} Refusing to start.`);
  process.exit(1);
}

console.error(
  `[tap-mcp] Starting in ${config.mode.toUpperCase()} mode.${
    config.mode === "live"
      ? " LIVE MONEY. Every call below is real."
      : " Simulated — no real money moves."
  }`,
);

const server = createTapMcpServer(config, (line) => console.error(`[tap-mcp] ${line}`));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[tap-mcp] Ready. Mode: ${config.mode.toUpperCase()}. 12 tools registered. (stdio)`);
}

main().catch((err) => {
  console.error("[tap-mcp] Fatal error:", err);
  process.exit(1);
});
