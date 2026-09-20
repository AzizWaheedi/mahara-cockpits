#!/usr/bin/env node
/**
 * Tap Payments MCP server — HTTP entrypoint (shared, network-reachable).
 *
 * Run this ONCE on the VPS. Every MCP client (Claude Code, Hermes, Codex,
 * whatever else) points at this one URL instead of each spawning its own
 * local stdio process — set up once, works everywhere, per Aziz's choice
 * on 2026-09-20.
 *
 * Transport: MCP Streamable HTTP (the current standard transport for
 * network-reachable MCP servers), stateless mode — a fresh transport per
 * request, no session state held in memory. Simpler and safer for a
 * single-tenant payments server than managing session lifecycles.
 *
 * AUTH — this is a payments server reachable over the network, so it is
 * NOT open by default:
 *
 *   MCP_BEARER_TOKEN   required. Every request must send
 *                       `Authorization: Bearer <token>` or gets 401.
 *                       This is separate from the Tap secret key — it's
 *                       who's allowed to talk to THIS server at all.
 *
 * Tap mode/keys work exactly as in the stdio entrypoint (src/index.ts):
 *   TAP_MODE              "test" | "live", defaults to "test"
 *   TAP_SECRET_KEY_TEST    required for test mode
 *   TAP_SECRET_KEY_LIVE    required only when TAP_MODE=live
 *
 * Listen address:
 *   PORT                  defaults to 8420
 *   HOST                  defaults to 0.0.0.0
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createTapMcpServer, resolveConfig, type TapClientConfig } from "./server.js";

let config: TapClientConfig;
try {
  config = resolveConfig();
} catch (err) {
  console.error(`[tap-mcp-http] ${err instanceof Error ? err.message : String(err)} Refusing to start.`);
  process.exit(1);
}

const bearerToken = process.env.MCP_BEARER_TOKEN;
if (!bearerToken) {
  console.error(
    "[tap-mcp-http] MCP_BEARER_TOKEN is not set. This server would be reachable over the " +
      "network with no auth at all — refusing to start rather than expose a payments API openly.",
  );
  process.exit(1);
}

const port = Number(process.env.PORT ?? 8420);
const host = process.env.HOST ?? "0.0.0.0";

console.error(
  `[tap-mcp-http] Starting in ${config.mode.toUpperCase()} mode.${
    config.mode === "live"
      ? " LIVE MONEY. Every call below is real."
      : " Simulated — no real money moves."
  }`,
);

function timingSafeTokenEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function checkAuth(req: IncomingMessage): boolean {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length).trim();
  return timingSafeTokenEqual(token, bearerToken as string);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  // Unauthenticated health check — no Tap data, just "is this process up".
  if (url.pathname === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, mode: config.mode, service: "tap-payments-mcp" }));
    return;
  }

  if (url.pathname !== "/mcp") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. The MCP endpoint is POST /mcp." }));
    return;
  }

  if (!checkAuth(req)) {
    console.error(
      `[tap-mcp-http] ${new Date().toISOString()} 401 unauthorized request from ${req.socket.remoteAddress}`,
    );
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized. Send Authorization: Bearer <MCP_BEARER_TOKEN>." }));
    return;
  }

  try {
    const body = req.method === "POST" ? await readBody(req) : undefined;

    // Stateless: a fresh server + transport per request. No session ID
    // generation, no in-memory session table to leak or expire. Slightly
    // more overhead per call than a stateful session, but this is a
    // low-volume payments tool, not a high-throughput chat backend, and
    // "no shared mutable state across requests" is worth more here than
    // the overhead saved.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const mcpServer = createTapMcpServer(config, (line) =>
      console.error(`[tap-mcp-http] ${line}`),
    );
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, body);

    res.on("close", () => {
      transport.close();
      mcpServer.close();
    });
  } catch (err) {
    console.error("[tap-mcp-http] Request handling error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  }
});

httpServer.listen(port, host, () => {
  console.error(
    `[tap-mcp-http] Ready. Mode: ${config.mode.toUpperCase()}. Listening on http://${host}:${port}/mcp ` +
      `(health check: http://${host}:${port}/health, no auth). 12 tools registered.`,
  );
});

process.on("SIGTERM", () => {
  console.error("[tap-mcp-http] SIGTERM received, shutting down.");
  httpServer.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  console.error("[tap-mcp-http] SIGINT received, shutting down.");
  httpServer.close(() => process.exit(0));
});
