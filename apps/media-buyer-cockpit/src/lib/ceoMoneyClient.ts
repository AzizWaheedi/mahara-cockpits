import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Money ties (docs/money/MONEY-ATTRIBUTION.md section 2), behind
 * `api.ceo.money.<op>`: the CEO ties a payment, or every payment from a payer,
 * to a signed deal, a client card, or "not client money". The tie is read by
 * the next money refresh, before any automatic match, so nothing here calls
 * Refresh now: the sheet says when it will show (`tiedSentence`).
 *
 * Both calls are CEO-gated RPCs of
 * supabase/migrations/20261018c_money_ties_deal_payments.sql, named literally
 * so the RPC inventory finds them. The checks here repeat the server's first
 * sentences so a slip is said before the round trip; the server decides.
 * No payer, email or amount is ever logged from here.
 */

type Row = Record<string, unknown>;

/** A tie: one scope (a payment, a payer email, a full payer name) and one target. */
export type PaymentTie = {
  /** A payment id from the Transactions tab: "whop:…", "tap:…", "transfer:…", "bank:…", "manual:…". */
  paymentId?: string;
  /** Every payment from this payer email. */
  payerEmail?: string;
  /** Every payment from this payer name, written in full (never a first name alone). */
  payerKey?: string;
  /** A signed closer-form deal (B2B response id): the money is that deal's closer's. */
  dealResponseId?: string;
  /** A client card (ClickUp task id). */
  clickupTaskId?: string;
  /** Money that is not a client's. */
  notClient?: boolean;
  /** Why, 3 to 500 characters. */
  note: string;
  evidence?: string;
};

export const PAYMENT_ID = /^(whop|tap|transfer|bank|manual):[A-Za-z0-9_.-]+$/;

/** The server's sentence without Postgres' prefixes, or a plain fallback. */
function sentence(raw: unknown, fallback: string): string {
  const text = String(raw ?? "")
    .split("\n")[0]
    .replace(/^(ERROR|error):\s*/, "")
    .replace(/^\[.*?]\s*/, "")
    .trim();
  return text || fallback;
}

const text = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/**
 * The tie as the server takes it, or the sentence that refuses it. The same
 * first checks as cockpit_ceo_payment_tie: one scope, one target, a note, a
 * payment id from the ledger's shape, an email, a full payer name.
 */
export function tiePayload(tie: PaymentTie): Row {
  const allowed = [
    "paymentId",
    "payerEmail",
    "payerKey",
    "dealResponseId",
    "clickupTaskId",
    "notClient",
    "note",
    "evidence",
  ];
  for (const k of Object.keys(tie ?? {}))
    if (!allowed.includes(k)) throw new Error(`Unsupported field: ${k}`);
  const paymentId = text(tie.paymentId);
  const payerEmail = text(tie.payerEmail)?.toLowerCase() ?? null;
  const payerKey = text(tie.payerKey);
  const deal = text(tie.dealResponseId);
  const card = text(tie.clickupTaskId);
  const notClient = tie.notClient === true;
  const note = String(tie.note ?? "").trim();
  const evidence = text(tie.evidence);
  if ([paymentId, payerEmail, payerKey].filter(Boolean).length !== 1)
    throw new Error("Tie one payment, one payer email or one payer name");
  if ([deal, card].filter(Boolean).length + (notClient ? 1 : 0) !== 1)
    throw new Error(
      "Choose one: a signed deal, a client card or not client money",
    );
  if (note.length < 3 || note.length > 500)
    throw new Error("Say why in a note of 3 to 500 characters");
  if (evidence && evidence.length > 1000)
    throw new Error("Keep the evidence under 1,000 characters");
  if (paymentId && (paymentId.length > 200 || !PAYMENT_ID.test(paymentId)))
    throw new Error("That is not a payment id from the Transactions tab");
  if (
    payerEmail &&
    (payerEmail.length > 320 || !/^[^@\s]+@[^@\s]+[.][^@\s]+$/.test(payerEmail))
  )
    throw new Error("That is not an email address");
  // Never a first name alone (the "Dena" lesson): six letters or more, two words or more.
  if (
    payerKey &&
    (payerKey.length > 200 ||
      payerKey.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").length < 6 ||
      !/\S\s+\S/.test(payerKey))
  )
    throw new Error("Tie by email or the full payer name.");
  const p: Row = { note };
  if (paymentId) p.paymentId = paymentId;
  if (payerEmail) p.payerEmail = payerEmail;
  if (payerKey) p.payerKey = payerKey;
  if (deal) p.dealResponseId = deal;
  if (card) p.clickupTaskId = card;
  if (notClient) p.notClient = true;
  if (evidence) p.evidence = evidence;
  return p;
}

function signedIn(client: SupabaseClient | null): SupabaseClient {
  if (!client) throw new Error("Sign in before attributing money.");
  return client;
}

function done(
  res: { data: unknown; error: { message?: string } | null },
  fallback: string,
): { ok: true; id: number } {
  if (res.error) throw new Error(sentence(res.error.message, fallback));
  const d = res.data as Row | null;
  if (d?.ok !== true || !Number.isSafeInteger(Number(d.id)))
    throw new Error(fallback);
  return { ok: true, id: Number(d.id) };
}

/** Tie money to a deal, a card or "not client money"; replaces the live tie of the same scope. → {ok, id} */
export async function tiePayment(
  client: SupabaseClient | null,
  tie: PaymentTie,
): Promise<{ ok: true; id: number }> {
  const p = tiePayload(tie);
  const res = await signedIn(client).rpc("cockpit_ceo_payment_tie", { p });
  return done(res, "The money was not tied. Nothing was changed.");
}

/** Remove a tie, with why. → {ok, id} */
export async function untiePayment(
  client: SupabaseClient | null,
  args: { id: number; reason: string },
): Promise<{ ok: true; id: number }> {
  if (!Number.isSafeInteger(args?.id) || args.id <= 0)
    throw new Error("Choose a tie to remove");
  const reason = String(args.reason ?? "").trim();
  if (reason.length < 3 || reason.length > 500)
    throw new Error("Say why the tie goes, in 3 to 500 characters");
  const res = await signedIn(client).rpc("cockpit_ceo_payment_untie", {
    p: { id: args.id, reason },
  });
  return done(res, "The tie was not removed. Nothing was changed.");
}

/**
 * What the sheet says after a tie: "Tied. It shows after the next money
 * refresh (about 15 minutes). Last refresh 09:40." The time is Kuwait's;
 * without a last refresh the sentence stops before it.
 */
export function tiedSentence(lastRefreshAt: string | null | undefined): string {
  const head =
    "Tied. It shows after the next money refresh (about 15 minutes).";
  const at = lastRefreshAt ? new Date(lastRefreshAt) : null;
  if (!at || Number.isNaN(at.getTime())) return head;
  const hhmm = at.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kuwait",
  });
  return `${head} Last refresh ${hhmm}.`;
}

/** `api.ceo.money.<op>`: both write. */
export async function ceoMoneyAction(
  client: SupabaseClient | null,
  op: string,
  args: any = {},
): Promise<unknown> {
  switch (op) {
    case "tie":
      return tiePayment(client, args);
    case "untie":
      return untiePayment(client, args);
    default:
      throw new Error(`Unknown money operation: ${op}`);
  }
}
