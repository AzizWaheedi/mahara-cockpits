import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Checked money (supabase/migrations/20261101n_checked_money.sql;
 * docs/forms/WAVE12-CONTRACT.md 3.1, 3.6 and 4.2). A payment someone logged
 * by hand is "logged, not checked" until finance or the CEO checks it
 * against the bank; cash, LTV, pay and Pending payments count checked money
 * only and say the logged money apart. This file is the browser's side of
 * it: the list waiting on a check, the check itself, the Checks waiting
 * door, and the pure words and readers the screens share.
 *
 * The same in the CEO cockpit and the client success cockpit
 * (scripts/check-shared.sh holds it to that). Pure apart from the three
 * calls; it never adds money up itself.
 */

export type CheckVerdict = "checked" | "rejected";

/** One row of cockpit_manual_payments_to_check(). */
export type CheckWaiting = {
  id: string;
  day: string;
  clientName: string;
  taskId: string | null;
  amount: number;
  currency: "USD" | "KWD";
  amountUsd: number;
  /** bank_transfer, cheque, cash, tap, ecom or other. */
  rail: string;
  kind: "payment" | "refund";
  reference: string | null;
  evidenceUrl: string | null;
  /** The seat that logged it ("Client success", "Billing agent", "The CEO"), never an email. */
  addedBy: string;
  addedAt: string;
  daysWaiting: number;
};

export type CheckResult = {
  id: string;
  state: CheckVerdict;
  checkedAt: string | null;
  /** "Checked" or "Rejected": the button's word in the past tense. */
  sentence: string;
};

/** A refusal in the server's own words (cockpit_manual_payment_check's sentences). */
export class PaymentCheckError extends Error {
  code: string | null;
  constructor(message: string, code: string | null = null) {
    super(message);
    this.code = code;
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const RAIL_WORDS: Record<string, string> = {
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  cash: "Cash",
  tap: "Tap",
  ecom: "Ecom",
  other: "Other",
};

/** "Bank transfer" for bank_transfer; the raw name for anything newer. */
export function railWords(rail: string | null | undefined): string {
  const r = String(rail ?? "");
  return (
    RAIL_WORDS[r] ?? (r ? r.charAt(0).toUpperCase() + r.slice(1) : "Unknown")
  );
}

/** "waiting 3 days", "logged today". */
export function waitingWords(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return "logged today";
  return `waiting ${days} ${days === 1 ? "day" : "days"}`;
}

function num(value: unknown, what: string): number {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    String(value).trim() === "" ||
    !Number.isFinite(Number(value))
  )
    throw new PaymentCheckError(
      `The list sent a ${what} that is not a number. Refresh it.`,
    );
  return Number(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

async function rpc(
  client: SupabaseClient,
  name: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await client.rpc(name, args);
  if (error)
    throw new PaymentCheckError(
      String(error.message ?? "").trim() ||
        "That did not reach the server, so nothing changed. Try again in a minute.",
      (error as { code?: string }).code ?? null,
    );
  return data;
}

/** One row as the screen uses it; a row the list cannot vouch for stops the read. */
export function toCheckWaiting(raw: unknown): CheckWaiting {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (
    typeof r.id !== "string" ||
    typeof r.day !== "string" ||
    !DAY.test(r.day) ||
    (r.currency !== "USD" && r.currency !== "KWD")
  )
    throw new PaymentCheckError(
      "The list sent a payment it cannot vouch for. Refresh it.",
    );
  return {
    id: r.id,
    day: r.day,
    clientName: text(r.clientName) ?? "No client name",
    taskId: text(r.taskId),
    amount: num(r.amount, "amount"),
    currency: r.currency,
    amountUsd: num(r.amountUsd, "dollar amount"),
    rail: String(r.rail ?? "other"),
    kind: r.kind === "refund" ? "refund" : "payment",
    reference: text(r.reference),
    evidenceUrl: text(r.evidenceUrl),
    addedBy: text(r.addedBy) ?? "Unknown seat",
    addedAt: String(r.addedAt ?? ""),
    daysWaiting: Number.isFinite(Number(r.daysWaiting))
      ? Number(r.daysWaiting)
      : 0,
  };
}

/** cockpit_manual_payments_to_check(): logged payments, oldest first (a CSM gets their own clients'). */
export async function manualPaymentsToCheck(
  client: SupabaseClient,
): Promise<CheckWaiting[]> {
  const data = await rpc(client, "cockpit_manual_payments_to_check");
  if (!Array.isArray(data))
    throw new PaymentCheckError(
      "The list of payments waiting on a check did not arrive. Refresh it.",
    );
  return data.map(toCheckWaiting);
}

/** cockpit_manual_payment_check: finance or the CEO checks or rejects one logged payment. */
export async function checkManualPayment(
  client: SupabaseClient,
  p: {
    id: string;
    verdict: CheckVerdict;
    ref?: string | null;
    statementLineId?: string | null;
  },
): Promise<CheckResult> {
  const data = (await rpc(client, "cockpit_manual_payment_check", {
    p_id: p.id,
    p_verdict: p.verdict,
    p_ref: p.ref?.trim() ? p.ref.trim() : null,
    p_statement_line_id: p.statementLineId?.trim()
      ? p.statementLineId.trim()
      : null,
  })) as Record<string, unknown> | null;
  if (
    data?.ok !== true ||
    data.id !== p.id ||
    (data.state !== "checked" && data.state !== "rejected")
  )
    throw new PaymentCheckError(
      "The server did not confirm the check. Refresh the list before trying again.",
    );
  return {
    id: p.id,
    state: data.state,
    checkedAt: text(data.checkedAt),
    sentence: data.state === "checked" ? "Checked" : "Rejected",
  };
}

/**
 * Whether Checks waiting may show: cockpit_form_doors().checks (20261101l),
 * true only once 20261101n is live and its forms.doors marker is on. Any
 * failure reads as closed, so the list never shows against a database that
 * cannot serve it.
 */
export async function checksDoorOpen(client: SupabaseClient): Promise<boolean> {
  try {
    const data = (await rpc(client, "cockpit_form_doors")) as Record<
      string,
      unknown
    > | null;
    return data?.checks === true;
  } catch {
    return false;
  }
}

/** Client-side checks before the call, in the server's words. Null when the form may send. */
export function checkProblem(
  verdict: CheckVerdict,
  ref: string,
  statementLineId: string,
): string | null {
  const r = ref.trim();
  const line = statementLineId.trim();
  if (r && (r.length < 3 || r.length > 200))
    return "Keep the bank reference or the reason between 3 and 200 characters.";
  if (verdict === "checked" && !r && !line)
    return "Name the bank reference or pick the statement line, so the check reads back.";
  if (verdict === "rejected" && !r)
    return "Say why it is rejected (3 to 200 characters), so the log reads back.";
  if (verdict === "rejected" && line)
    return "A rejected payment has no statement line. Leave the line empty.";
  return null;
}

// --- what the money refresh publishes (contract 3.6) -------------------------

/** rails.manualLogged: hand-logged money waiting on a check, never in the cash total. */
export type ManualLogged = {
  count: number;
  usd: number;
  oldestDay: string | null;
};

/** Reads rails.manualLogged from a money payload; null when the refresh did not publish it (an older adapter). */
export function manualLoggedOf(payload: unknown): ManualLogged | null {
  const raw = (payload as { rails?: { manualLogged?: unknown } } | null)?.rails
    ?.manualLogged as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return null;
  const count = Number(raw.count);
  const usd = Number(raw.usd);
  if (!Number.isInteger(count) || count < 0 || !Number.isFinite(usd))
    return null;
  const oldest =
    typeof raw.oldestDay === "string" && DAY.test(raw.oldestDay)
      ? raw.oldestDay
      : null;
  return { count, usd, oldestDay: oldest };
}

/** A published transaction that is hand-logged money nobody has checked yet. */
export function isUnchecked(t: object): boolean {
  return (t as { checked?: unknown }).checked === false;
}

/** The manual list's state, as the money refresh published it (payload.manualChecks). */
export type ManualCheckState = {
  id: string;
  state: "logged" | "checked" | "rejected";
  at: string | null;
  ref: string | null;
};

/** Reads payload.manualChecks into a map by payment id; empty when the refresh did not publish it. */
export function manualChecksOf(
  payload: unknown,
): Map<string, ManualCheckState> {
  const list = (payload as { manualChecks?: unknown } | null)?.manualChecks;
  const out = new Map<string, ManualCheckState>();
  if (!Array.isArray(list)) return out;
  for (const raw of list) {
    const r = (raw ?? {}) as Record<string, unknown>;
    if (typeof r.id !== "string") continue;
    if (r.state !== "logged" && r.state !== "checked" && r.state !== "rejected")
      continue;
    out.set(r.id, {
      id: r.id,
      state: r.state,
      at: text(r.at),
      ref: text(r.ref),
    });
  }
  return out;
}
