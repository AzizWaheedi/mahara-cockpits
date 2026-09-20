#!/usr/bin/env node
/**
 * Tap Payments MCP server.
 *
 * Built in-house 2026-09-20 after the third-party mcpmarket.com listing
 * failed vetting: 0 GitHub stars, no visible source repository, unverified
 * maintainer — not something to hand a live payments secret key to. This
 * server holds the key itself, on infrastructure Aziz controls.
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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  type TapClientConfig,
  TapApiError,
  createCharge,
  retrieveCharge,
  listCharges,
  createRefund,
  retrieveRefund,
  listRefunds,
  createCustomer,
  retrieveCustomer,
  listCustomers,
  createInvoice,
  retrieveInvoice,
  listInvoices,
} from "./tap.js";

const mode = (process.env.TAP_MODE ?? "test").toLowerCase();
if (mode !== "test" && mode !== "live") {
  console.error(`[tap-mcp] Invalid TAP_MODE "${mode}" — must be "test" or "live". Exiting.`);
  process.exit(1);
}

const secretKey =
  mode === "live" ? process.env.TAP_SECRET_KEY_LIVE : process.env.TAP_SECRET_KEY_TEST;

if (!secretKey) {
  console.error(
    `[tap-mcp] TAP_MODE=${mode} but ${
      mode === "live" ? "TAP_SECRET_KEY_LIVE" : "TAP_SECRET_KEY_TEST"
    } is not set. Refusing to start rather than fail on first call.`,
  );
  process.exit(1);
}

const config: TapClientConfig = { secretKey, mode: mode as "test" | "live" };

console.error(
  `[tap-mcp] Starting in ${mode.toUpperCase()} mode.${
    mode === "live" ? " LIVE MONEY. Every call below is real." : " Simulated — no real money moves."
  }`,
);

function logCall(tool: string, ok: boolean, detail?: string) {
  const stamp = new Date().toISOString();
  console.error(
    `[tap-mcp] ${stamp} mode=${mode} tool=${tool} ok=${ok}${detail ? ` ${detail}` : ""}`,
  );
}

function errorResult(tool: string, err: unknown) {
  const message =
    err instanceof TapApiError
      ? `Tap API error ${err.status}: ${JSON.stringify(err.body)}`
      : err instanceof Error
        ? err.message
        : String(err);
  logCall(tool, false, message);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

function jsonResult(tool: string, data: unknown) {
  logCall(tool, true);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

const server = new McpServer({
  name: "tap-payments-mcp",
  version: "1.0.0",
});

// ---------------------------------------------------------------------------
// Charges
// ---------------------------------------------------------------------------

server.registerTool(
  "tap_create_charge",
  {
    title: "Create a Tap charge",
    description: `Create a payment charge via Tap Payments. Running in ${mode.toUpperCase()} mode — ${
      mode === "test"
        ? "this is simulated, no real card is charged, safe to use freely."
        : "THIS IS REAL. A real card will be charged real money."
    } Amount is in the currency's major unit (e.g. 5.000 KWD, not fils). A redirect_url is REQUIRED whenever sourceId is a hosted-page source (src_all or any src_*.* local method) — Tap redirects the customer there after payment. Omit it only when using a saved card token as the source.`,
    inputSchema: {
      amount: z.number().positive().describe("Amount to charge, e.g. 5.000"),
      currency: z.string().length(3).default("KWD").describe("ISO currency code, e.g. KWD, USD, SAR"),
      customerFirstName: z.string().optional(),
      customerLastName: z.string().optional(),
      customerEmail: z.string().email().optional(),
      customerPhoneCountryCode: z.string().optional().describe("e.g. 965 for Kuwait"),
      customerPhoneNumber: z.string().optional(),
      sourceId: z
        .string()
        .default("src_all")
        .describe(
          "Payment source id. src_all shows all methods on a hosted page (requires redirectUrl). Use src_kw.knet for KNET (requires redirectUrl), token_id for a saved card token, etc.",
        ),
      description: z.string().optional(),
      redirectUrl: z
        .string()
        .url()
        .optional()
        .describe(
          "REQUIRED for hosted-page sources (src_all, src_kw.knet, etc.) — where Tap redirects the customer after payment.",
        ),
    },
  },
  async (args) => {
    try {
      const result = await createCharge(config, {
        amount: args.amount,
        currency: args.currency,
        customer: {
          first_name: args.customerFirstName,
          last_name: args.customerLastName,
          email: args.customerEmail,
          phone:
            args.customerPhoneCountryCode || args.customerPhoneNumber
              ? { country_code: args.customerPhoneCountryCode, number: args.customerPhoneNumber }
              : undefined,
        },
        source: { id: args.sourceId },
        description: args.description,
        redirect: args.redirectUrl ? { url: args.redirectUrl } : undefined,
      });
      return jsonResult("tap_create_charge", result);
    } catch (err) {
      return errorResult("tap_create_charge", err);
    }
  },
);

server.registerTool(
  "tap_retrieve_charge",
  {
    title: "Retrieve a Tap charge",
    description: "Look up a single charge by its charge_id. Read-only, safe in any mode.",
    inputSchema: {
      chargeId: z.string().describe("The charge_id, e.g. chg_TS0212..."),
    },
  },
  async (args) => {
    try {
      const result = await retrieveCharge(config, args.chargeId);
      return jsonResult("tap_retrieve_charge", result);
    } catch (err) {
      return errorResult("tap_retrieve_charge", err);
    }
  },
);

server.registerTool(
  "tap_list_charges",
  {
    title: "List Tap charges",
    description: "List recent charges, most recent first. Read-only, safe in any mode.",
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional().describe("Default 25, max 50"),
      startingAfter: z.string().optional().describe("Charge id to paginate after"),
      status: z
        .string()
        .optional()
        .describe("Filter by status: INITIATED, IN_PROGRESS, ABANDONED, CANCELLED, FAILED, DECLINED, RESTRICTED, CAPTURED, VOID, TIMEDOUT, UNKNOWN"),
    },
  },
  async (args) => {
    try {
      const result = await listCharges(config, args);
      return jsonResult("tap_list_charges", result);
    } catch (err) {
      return errorResult("tap_list_charges", err);
    }
  },
);

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

server.registerTool(
  "tap_create_refund",
  {
    title: "Refund a Tap charge",
    description: `Refund a charge, full or partial. Running in ${mode.toUpperCase()} mode — ${
      mode === "test"
        ? "this is simulated, safe to use freely."
        : "THIS IS REAL. Real money moves back to the customer's card. Cannot be undone."
    } Omit amount for a full refund.`,
    inputSchema: {
      chargeId: z.string().describe("The charge_id to refund"),
      amount: z.number().positive().optional().describe("Omit for a full refund; set for a partial refund"),
      currency: z.string().length(3).optional(),
      reason: z.string().optional().describe("Free-text reason, stored on the refund record"),
    },
  },
  async (args) => {
    try {
      const result = await createRefund(config, {
        charge_id: args.chargeId,
        amount: args.amount,
        currency: args.currency,
        reason: args.reason,
      });
      return jsonResult("tap_create_refund", result);
    } catch (err) {
      return errorResult("tap_create_refund", err);
    }
  },
);

server.registerTool(
  "tap_retrieve_refund",
  {
    title: "Retrieve a Tap refund",
    description: "Look up a single refund by its refund id. Read-only, safe in any mode.",
    inputSchema: {
      refundId: z.string(),
    },
  },
  async (args) => {
    try {
      const result = await retrieveRefund(config, args.refundId);
      return jsonResult("tap_retrieve_refund", result);
    } catch (err) {
      return errorResult("tap_retrieve_refund", err);
    }
  },
);

server.registerTool(
  "tap_list_refunds",
  {
    title: "List Tap refunds",
    description: "List recent refunds, most recent first. Read-only, safe in any mode.",
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional(),
      startingAfter: z.string().optional().describe("Refund id to paginate after"),
      status: z.string().optional(),
    },
  },
  async (args) => {
    try {
      const result = await listRefunds(config, args);
      return jsonResult("tap_list_refunds", result);
    } catch (err) {
      return errorResult("tap_list_refunds", err);
    }
  },
);

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

server.registerTool(
  "tap_create_customer",
  {
    title: "Create a Tap customer",
    description: `Create a customer profile in Tap. Running in ${mode.toUpperCase()} mode.`,
    inputSchema: {
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      email: z.string().email().optional(),
      phoneCountryCode: z.string().optional(),
      phoneNumber: z.string().optional(),
    },
  },
  async (args) => {
    try {
      const result = await createCustomer(config, {
        first_name: args.firstName,
        last_name: args.lastName,
        email: args.email,
        phone:
          args.phoneCountryCode || args.phoneNumber
            ? { country_code: args.phoneCountryCode, number: args.phoneNumber }
            : undefined,
      });
      return jsonResult("tap_create_customer", result);
    } catch (err) {
      return errorResult("tap_create_customer", err);
    }
  },
);

server.registerTool(
  "tap_retrieve_customer",
  {
    title: "Retrieve a Tap customer",
    description: "Look up a customer by id. Read-only, safe in any mode.",
    inputSchema: {
      customerId: z.string(),
    },
  },
  async (args) => {
    try {
      const result = await retrieveCustomer(config, args.customerId);
      return jsonResult("tap_retrieve_customer", result);
    } catch (err) {
      return errorResult("tap_retrieve_customer", err);
    }
  },
);

server.registerTool(
  "tap_list_customers",
  {
    title: "List Tap customers",
    description: "List customers, most recent first. Read-only, safe in any mode.",
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional(),
      startingAfter: z.string().optional().describe("Customer id to paginate after"),
    },
  },
  async (args) => {
    try {
      const result = await listCustomers(config, args);
      return jsonResult("tap_list_customers", result);
    } catch (err) {
      return errorResult("tap_list_customers", err);
    }
  },
);

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

server.registerTool(
  "tap_create_invoice",
  {
    title: "Create a Tap invoice",
    description: `Create and send an invoice via Tap. Running in ${mode.toUpperCase()} mode — ${
      mode === "test" ? "simulated." : "THIS IS REAL and may email the customer."
    }`,
    inputSchema: {
      currency: z.string().length(3).default("KWD"),
      customerFirstName: z.string().optional(),
      customerLastName: z.string().optional(),
      customerEmail: z.string().email().optional(),
      customerPhoneCountryCode: z.string().optional(),
      customerPhoneNumber: z.string().optional(),
      draft: z.boolean().optional().describe("true = save as draft, do not send"),
      dueTimestamp: z.number().optional().describe("Unix timestamp the invoice is due"),
    },
  },
  async (args) => {
    try {
      const result = await createInvoice(config, {
        currency: args.currency,
        customer: {
          first_name: args.customerFirstName,
          last_name: args.customerLastName,
          email: args.customerEmail,
          phone:
            args.customerPhoneCountryCode || args.customerPhoneNumber
              ? { country_code: args.customerPhoneCountryCode, number: args.customerPhoneNumber }
              : undefined,
        },
        draft: args.draft,
        due: args.dueTimestamp,
      });
      return jsonResult("tap_create_invoice", result);
    } catch (err) {
      return errorResult("tap_create_invoice", err);
    }
  },
);

server.registerTool(
  "tap_retrieve_invoice",
  {
    title: "Retrieve a Tap invoice",
    description: "Look up an invoice by id. Read-only, safe in any mode.",
    inputSchema: {
      invoiceId: z.string(),
    },
  },
  async (args) => {
    try {
      const result = await retrieveInvoice(config, args.invoiceId);
      return jsonResult("tap_retrieve_invoice", result);
    } catch (err) {
      return errorResult("tap_retrieve_invoice", err);
    }
  },
);

server.registerTool(
  "tap_list_invoices",
  {
    title: "List Tap invoices",
    description: "List invoices, most recent first. Read-only, safe in any mode.",
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional(),
      startingAfter: z.string().optional().describe("Invoice id to paginate after"),
    },
  },
  async (args) => {
    try {
      const result = await listInvoices(config, args);
      return jsonResult("tap_list_invoices", result);
    } catch (err) {
      return errorResult("tap_list_invoices", err);
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[tap-mcp] Ready. Mode: ${mode.toUpperCase()}. 12 tools registered.`);
}

main().catch((err) => {
  console.error("[tap-mcp] Fatal error:", err);
  process.exit(1);
});
