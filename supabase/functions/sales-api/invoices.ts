// Invoices from the sales cockpit (Aziz, 2026-10-29: "the same invoices
// section ... that the CSM has for the deposit ... If the ecom link doesn't
// work, they can generate a WHOP link as well").
//
// The invoice desk is the client success cockpit's: cockpit_invoice_request
// and cockpit_invoice_change check the seat, the client and every number,
// queue the row and write the audit; the VPS invoice desk numbers it, makes
// the Ecom or Whop link, prints the PDF and files it. These actions only
// carry the rep's own sign-in to those functions (auth.uid() decides who
// asked), keep to the fields the form has, and mark the request as the sales
// cockpit's. The database's refusals reach the rep word for word.

import { cleanText, type Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";

type Row = Record<string, unknown>;

export interface InvoiceDeps {
  /** A database function called with the rep's own sign-in, not the service key. */
  rpcAsUser: (who: Who, fn: string, args: Row) => Promise<unknown>;
}

/** The form's fields, as cockpit_invoice_request reads them. */
export const REQUEST_KEYS = [
  "taskId",
  "kind",
  "amount",
  "description",
  "lineNote",
  "clientDetail",
  "taxId",
  "period",
  "payNote",
  "dueDate",
  "checkoutUrl",
  "createLink",
  "provider",
  "payments",
] as const;

export const CHANGES = ["cancel", "retry", "whop"] as const;

/** Only the form's own fields go up, plus who is asking. */
export function requestArgs(input: unknown): Row {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ApiRefusal("The invoice details are missing. Fill in the form and try again.");
  const a = input as Row;
  const out: Row = {};
  for (const k of REQUEST_KEYS) if (k in a && a[k] !== undefined) out[k] = a[k];
  out.app = "sales";
  return out;
}

export function makeInvoices(deps: InvoiceDeps) {
  async function request(who: Who, b: Row): Promise<Row> {
    const invoice = await deps.rpcAsUser(who, "cockpit_invoice_request", { p_args: requestArgs(b.args) });
    return { invoice };
  }

  async function change(who: Who, b: Row): Promise<Row> {
    const id = cleanText(b.id, 40);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      throw new ApiRefusal("Which invoice? Refresh the page.");
    const action = String(b.change ?? "");
    if (!(CHANGES as readonly string[]).includes(action)) throw new ApiRefusal("Unknown invoice action.");
    const invoice = await deps.rpcAsUser(who, "cockpit_invoice_change", { p_id: id, p_action: action, p_app: "sales" });
    return { invoice };
  }

  return {
    actions: {
      "invoice.request": request,
      "invoice.change": change,
    } as Record<string, (who: Who, b: Row) => Promise<Row>>,
  };
}
