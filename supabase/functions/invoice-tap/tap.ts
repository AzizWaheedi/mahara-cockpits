// The Tap side of invoice-tap: the one request body the cockpit sends to Tap,
// and the checks on what Tap sends back. Pure: no network, no keys.
//
// A Tap invoice is a payment page in KWD (KNET and cards) for one cockpit
// invoice. Tap's own messages are off (notifications.dispatch false, receipts
// off): the client gets the link on the cockpit's PDF, nothing from Tap.
// Request shape proven in Tap's sandbox on 2026-11-05 (inv_ecJq1311012951z527261).

export type Row = Record<string, unknown>;

export const TAP_API = "https://api.tap.company/v2";
export const TAP_ID = /^inv_[A-Za-z0-9]{6,80}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NUMBER = /^INV-[0-9]{4}-[0-9]{3,}$/;
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/;
const KWD = /^[0-9]+\.[0-9]{3}$/;
const USD = /^[0-9]{1,6}(\.[0-9]{1,2})?$/;
const DAY = /^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/;
const KUWAIT_OFFSET_MS = 3 * 3600 * 1000;
const DAY_MS = 86_400_000;
/** Tap's smallest KWD invoice the cockpit will ask for. */
export const MIN_KWD = 0.1;

/** A request the function will not send, or an answer it will not accept. */
export class Refused extends Error {}

export interface CreateInput {
  invoiceId: string;
  number: string;
  clientName: string;
  clientEmail: string;
  description: string;
  amountKwd: string;
  amountUsd: string;
  dueDate: string;
}

export interface TapInvoice {
  id: string;
  url: string;
  status: "UNPAID" | "PAID" | "CANCELLED" | "EXPIRED";
  tapStatus: string;
  amount: number;
  currency: string;
  live: boolean;
  cockpitInvoice: string;
  paidAt: string | null;
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

/** The worker's create request, checked field by field. */
export function readCreate(body: Row): CreateInput {
  const out: CreateInput = {
    invoiceId: text(body.invoiceId),
    number: text(body.number),
    clientName: text(body.clientName),
    clientEmail: text(body.clientEmail).toLowerCase(),
    description: text(body.description),
    amountKwd: text(body.amountKwd),
    amountUsd: text(body.amountUsd),
    dueDate: text(body.dueDate).slice(0, 10),
  };
  if (!UUID.test(out.invoiceId)) throw new Refused("invoiceId must be the cockpit invoice id.");
  if (!NUMBER.test(out.number)) throw new Refused("number must be the invoice number, INV-YYYY-###.");
  if (!out.clientName || out.clientName.length > 120) throw new Refused("clientName is missing or too long.");
  if (!EMAIL.test(out.clientEmail) || out.clientEmail.length > 254) throw new Refused("clientEmail is not an email.");
  if (!out.description || out.description.length > 120) throw new Refused("description is missing or too long.");
  if (!KWD.test(out.amountKwd) || Number(out.amountKwd) < MIN_KWD) {
    throw new Refused(`amountKwd must be KWD with 3 decimals, at least ${MIN_KWD.toFixed(3)}.`);
  }
  if (!USD.test(out.amountUsd) || Number(out.amountUsd) <= 0) throw new Refused("amountUsd must be the USD amount.");
  if (!DAY.test(out.dueDate) || Number.isNaN(Date.parse(`${out.dueDate}T00:00:00Z`))) {
    throw new Refused("dueDate must be YYYY-MM-DD.");
  }
  return out;
}

/** The end of a Kuwait day, in ms. */
function endOfKuwaitDay(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) - KUWAIT_OFFSET_MS + DAY_MS - 1000;
}

/**
 * The Tap invoice for one cockpit invoice. Due at the end of its due day in
 * Kuwait, or a day from now when that has passed (an invoice made for an old
 * payment); the link stays payable 15 days after that, as Ecom's does.
 */
export function createBody(input: CreateInput, now: number): Row {
  const due = Math.max(endOfKuwaitDay(input.dueDate), now + DAY_MS);
  const amount = Number(input.amountKwd);
  return {
    draft: false,
    due,
    expiry: due + 15 * DAY_MS,
    description: input.description,
    mode: "INVOICEPAY",
    note: `Mahara Media invoice ${input.number}`,
    notifications: { channels: ["EMAIL"], dispatch: false },
    currencies: ["KWD"],
    charge: { receipt: { email: false, sms: false } },
    metadata: { cockpit_invoice: input.invoiceId, invoice_no: input.number },
    customer: { first_name: input.clientName.slice(0, 50), email: input.clientEmail },
    order: {
      amount,
      currency: "KWD",
      items: [
        {
          name: input.description.slice(0, 100),
          description: `${input.number}: USD ${input.amountUsd} in KWD at the day's rate`,
          amount,
          currency: "KWD",
          quantity: 1,
        },
      ],
    },
    payment_methods: [""],
    reference: { invoice: input.number, order: input.invoiceId },
  };
}

export function normalizeStatus(raw: unknown): TapInvoice["status"] {
  const s = text(raw).toUpperCase();
  if (s === "PAID") return "PAID";
  if (s === "CANCELLED" || s === "CANCELED") return "CANCELLED";
  if (s === "EXPIRED") return "EXPIRED";
  return "UNPAID";
}

function ms(v: unknown): number {
  const n = typeof v === "number" ? v : Number(text(v));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e11 ? n * 1000 : n;
}

/** What Tap said about one invoice, in the cockpit's words. Throws on a malformed answer. */
export function summarize(raw: Row): TapInvoice {
  const id = text(raw.id);
  const url = text(raw.url);
  if (!TAP_ID.test(id)) throw new Refused("Tap did not return an invoice id.");
  if (!/^https:\/\/([a-z0-9-]+\.)*tap\.company\/[^\s<>"']+$/.test(url) || url.length > 500) {
    throw new Refused(`Tap invoice ${id} has no valid payment page.`);
  }
  const status = normalizeStatus(raw.status);
  const updated = ms(raw.updated);
  return {
    id,
    url,
    status,
    tapStatus: text(raw.status).slice(0, 40) || "UNKNOWN",
    amount: Number(raw.amount),
    currency: text(raw.currency).toUpperCase(),
    live: raw.live_mode === true,
    cockpitInvoice: text((raw.metadata as Row | undefined)?.cockpit_invoice),
    paidAt: status === "PAID" && updated ? new Date(updated).toISOString() : null,
  };
}

/**
 * The checks before a Tap link goes on a client's invoice: the cockpit's own
 * invoice, live (never a sandbox page), KWD, the exact amount, still payable.
 */
export function check(inv: TapInvoice, want: { invoiceId: string; amountKwd: string; live: boolean }): TapInvoice {
  if (inv.cockpitInvoice !== want.invoiceId) throw new Refused(`Tap invoice ${inv.id} belongs to another cockpit invoice.`);
  if (inv.live !== want.live || (want.live && /sandbox/i.test(inv.url))) {
    throw new Refused(`Tap invoice ${inv.id} is ${inv.live ? "live" : "a test"}; the cockpit expected ${want.live ? "live" : "a test"}.`);
  }
  if (inv.currency !== "KWD" || Math.round(inv.amount * 1000) !== Math.round(Number(want.amountKwd) * 1000)) {
    throw new Refused(`Tap invoice ${inv.id} is ${inv.currency} ${inv.amount}, not KWD ${want.amountKwd}. Do not make another link.`);
  }
  if (inv.status === "CANCELLED" || inv.status === "EXPIRED") {
    throw new Refused(`Tap invoice ${inv.id} is ${inv.status.toLowerCase()}. Cancel this cockpit invoice and make a new one.`);
  }
  return inv;
}

/** Tap's error text without keys or long bodies. */
export function scrub(s: string): string {
  return s
    .replace(/\b[sp]k_(test|live)_[A-Za-z0-9]+/gi, "[key]")
    .replace(/\s+/g, " ")
    .slice(0, 200);
}

/** Tap's reason, from its { errors: [{ code, description }] } answer. */
export function tapReason(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { errors?: Array<{ code?: unknown; description?: unknown }> };
    const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
    const words = errors.map(e => `${text(String(e.code ?? ""))} ${text(String(e.description ?? ""))}`.trim()).filter(Boolean);
    if (words.length) return scrub(`HTTP ${status}: ${words.join("; ")}`);
  } catch {
    // not JSON
  }
  return scrub(`HTTP ${status}: ${body}`);
}
