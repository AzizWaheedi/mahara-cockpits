/**
 * Shared MCP server factory — builds a fresh McpServer instance with all 12
 * Tap tools registered, given a resolved config. Used by both the stdio
 * entrypoint (local, one process per client) and the HTTP entrypoint
 * (shared, network-reachable, one process serving many clients).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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

export type { TapClientConfig };

export function resolveConfig(): TapClientConfig {
  const mode = (process.env.TAP_MODE ?? "test").toLowerCase();
  if (mode !== "test" && mode !== "live") {
    throw new Error(`Invalid TAP_MODE "${mode}" — must be "test" or "live".`);
  }
  const secretKey =
    mode === "live" ? process.env.TAP_SECRET_KEY_LIVE : process.env.TAP_SECRET_KEY_TEST;
  if (!secretKey) {
    throw new Error(
      `TAP_MODE=${mode} but ${
        mode === "live" ? "TAP_SECRET_KEY_LIVE" : "TAP_SECRET_KEY_TEST"
      } is not set.`,
    );
  }
  return { secretKey, mode: mode as "test" | "live" };
}

export function createTapMcpServer(config: TapClientConfig, log: (line: string) => void) {
  const mode = config.mode;

  function logCall(tool: string, ok: boolean, detail?: string) {
    const stamp = new Date().toISOString();
    log(`${stamp} mode=${mode} tool=${tool} ok=${ok}${detail ? ` ${detail}` : ""}`);
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

  // ---------------------------------------------------------------------
  // Charges
  // ---------------------------------------------------------------------

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
          .describe(
            "Filter by status: INITIATED, IN_PROGRESS, ABANDONED, CANCELLED, FAILED, DECLINED, RESTRICTED, CAPTURED, VOID, TIMEDOUT, UNKNOWN",
          ),
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

  // ---------------------------------------------------------------------
  // Refunds
  // ---------------------------------------------------------------------

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

  // ---------------------------------------------------------------------
  // Customers
  // ---------------------------------------------------------------------

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

  // ---------------------------------------------------------------------
  // Invoices
  // ---------------------------------------------------------------------

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

  return server;
}
