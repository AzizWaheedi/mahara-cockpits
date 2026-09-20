/**
 * Thin, honest client for the Tap Payments v2 API.
 *
 * No retries-that-hide-failures, no silent fallbacks. Every call either
 * returns Tap's real response or throws with Tap's real error body attached,
 * so the calling MCP tool can surface exactly what happened rather than a
 * flattened "something went wrong".
 *
 * Base URL and auth mode: docs.tap.company confirms POST/GET against
 * https://api.tap.company/v2/... with `Authorization: Bearer <secret_key>`.
 * Verified live 2026-09-20 against the account's own test secret key
 * (auth accepted; a made-up charge id correctly 404s with Tap's own
 * "Request not found" body rather than an auth error).
 */

const BASE_URL = "https://api.tap.company/v2";

export type TapMode = "test" | "live";

export interface TapClientConfig {
  secretKey: string;
  mode: TapMode;
}

export class TapApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    const description =
      typeof body === "object" && body !== null && "errors" in body
        ? JSON.stringify((body as { errors: unknown }).errors)
        : JSON.stringify(body);
    super(`Tap API error ${status}: ${description}`);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  config: TapClientConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }

  if (!res.ok) {
    throw new TapApiError(res.status, parsed);
  }
  return parsed as T;
}

// ---------------------------------------------------------------------------
// Charges
// ---------------------------------------------------------------------------

export interface CreateChargeInput {
  amount: number;
  currency: string;
  customer: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: { country_code?: string; number?: string };
  };
  source: { id: string };
  description?: string;
  threeDSecure?: boolean;
  save_card?: boolean;
  customer_initiated?: boolean;
  redirect?: { url: string };
  post?: { url: string };
  metadata?: Record<string, string>;
  reference?: Record<string, string>;
}

export function createCharge(config: TapClientConfig, input: CreateChargeInput) {
  // Trailing slash matches Tap's documented endpoint exactly.
  return request<Record<string, unknown>>(config, "POST", "/charges/", input);
}

export function retrieveCharge(config: TapClientConfig, chargeId: string) {
  return request<Record<string, unknown>>(config, "GET", `/charges/${chargeId}`);
}

export function listCharges(
  config: TapClientConfig,
  params: { limit?: number; startingAfter?: string; status?: string } = {},
) {
  // Confirmed live 2026-09-20: this is POST /v2/charges/list with a JSON
  // body, NOT a GET with query params — the OpenAPI spec at
  // developers.tap.company/reference/list-all-charges.md says so and a
  // live call against the account's own test key matches it exactly
  // (a GET here 404s with "Request not found"; the POST below returns
  // Tap's real "Charges not found" on an empty account instead).
  return request<Record<string, unknown>>(config, "POST", "/charges/list", {
    limit: params.limit !== undefined ? String(params.limit) : undefined,
    starting_after: params.startingAfter,
    status: params.status,
  });
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

export interface CreateRefundInput {
  charge_id: string;
  amount?: number;
  currency?: string;
  reason?: string;
  metadata?: Record<string, string>;
}

export function createRefund(config: TapClientConfig, input: CreateRefundInput) {
  return request<Record<string, unknown>>(config, "POST", "/refunds/", input);
}

export function retrieveRefund(config: TapClientConfig, refundId: string) {
  return request<Record<string, unknown>>(config, "GET", `/refunds/${refundId}`);
}

export function listRefunds(
  config: TapClientConfig,
  params: { limit?: number; startingAfter?: string; status?: string } = {},
) {
  // Verified live 2026-09-20, same POST /list pattern as charges.
  return request<Record<string, unknown>>(config, "POST", "/refunds/list", {
    limit: params.limit !== undefined ? String(params.limit) : undefined,
    starting_after: params.startingAfter,
    status: params.status,
  });
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export interface CreateCustomerInput {
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  email?: string;
  phone?: { country_code?: string; number?: string };
  metadata?: Record<string, string>;
}

export function createCustomer(config: TapClientConfig, input: CreateCustomerInput) {
  return request<Record<string, unknown>>(config, "POST", "/customers/", input);
}

export function retrieveCustomer(config: TapClientConfig, customerId: string) {
  return request<Record<string, unknown>>(config, "GET", `/customers/${customerId}`);
}

export function listCustomers(
  config: TapClientConfig,
  params: { limit?: number; startingAfter?: string } = {},
) {
  // Verified live 2026-09-20, same POST /list pattern.
  return request<Record<string, unknown>>(config, "POST", "/customers/list", {
    limit: params.limit !== undefined ? String(params.limit) : undefined,
    starting_after: params.startingAfter,
  });
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export interface CreateInvoiceInput {
  draft?: boolean;
  due?: number;
  expiry?: number;
  mode?: "INVOICE" | "PAY" | "INVOICEPAY";
  description?: string;
  currency: string;
  customer: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: { country_code?: string; number?: string };
  };
  order?: Record<string, unknown>;
  charge?: Record<string, unknown>;
  notifications?: Record<string, unknown>;
  metadata?: Record<string, string>;
}

export function createInvoice(config: TapClientConfig, input: CreateInvoiceInput) {
  return request<Record<string, unknown>>(config, "POST", "/invoices/", input);
}

export function retrieveInvoice(config: TapClientConfig, invoiceId: string) {
  return request<Record<string, unknown>>(config, "GET", `/invoices/${invoiceId}`);
}

export function listInvoices(
  config: TapClientConfig,
  params: { limit?: number; startingAfter?: string } = {},
) {
  // Verified live 2026-09-20, same POST /list pattern.
  return request<Record<string, unknown>>(config, "POST", "/invoices/list", {
    limit: params.limit !== undefined ? String(params.limit) : undefined,
    starting_after: params.startingAfter,
  });
}
