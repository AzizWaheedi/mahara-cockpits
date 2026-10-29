/**
 * The provider ledger of the client messages sender (docs/forms/STAGE2B-CONTRACT.md
 * 4.3, 3b). Every provider call goes through `ledgerFetch`: before the request
 * leaves it awaits an intent receipt in cockpit_csm_provider_health (no
 * receipt, no request), then writes the response or unknown receipt. It
 * refuses any method but GET, except exactly two POSTs: the WhatsApp send and
 * the Google token exchange that the read-only Sheets credential needs. The
 * resource is the host and path with ids collapsed: never a group id, a card,
 * a person, a token or text.
 *
 * Whatever stops a call before it leaves (a refused method, an intent receipt
 * that cannot be written, a caller's time limit already spent while the
 * receipt was written) throws `NotSent`, so the WhatsApp send can tell "never
 * left" (failed, try again) from "left and unconfirmed" (unknown): whapi.ts's
 * `sendText` notes it in its own fetcher, before Transport.json wraps it.
 */

export type Receipt = {
  provider: string;
  method: string;
  resource: string;
  phase: "intent" | "response" | "unknown";
  http_status: number | null;
  object_id: string | null;
  action_id: null;
  run_key: string;
};
export type InsertReceipt = (row: Receipt) => Promise<void>;

const PROVIDERS: Record<string, string> = {
  "gate.whapi.cloud": "whapi",
  "sheets.googleapis.com": "google",
  "oauth2.googleapis.com": "google",
  "api.clickup.com": "clickup",
  "api.typeform.com": "typeform",
};

/** The two POSTs that may leave this worker, exactly. */
export const ALLOWED_POSTS = [
  "https://gate.whapi.cloud/messages/text",
  "https://oauth2.googleapis.com/token",
] as const;

/** The provider a host belongs to: Make by its zone host, the rest by name; null for anything else. */
export function providerOf(host: string): string | null {
  const h = host.toLowerCase();
  if (PROVIDERS[h]) return PROVIDERS[h];
  if (h === "make.com" || h.endsWith(".make.com")) return "make";
  return null;
}

/** Host and path with every id collapsed (a group, a card, a sheet, a scenario, a form's webhooks keep their shape). */
export function resourceOf(url: URL): string {
  const parts = url.pathname.split("/").map(seg => {
    if (!seg) return seg;
    const s = decodeURIComponent(seg);
    if (s.includes("@")) return ":group";
    if (/\d/.test(s) && s.length >= 5) return ":id";
    return seg;
  });
  return `${url.host}${parts.join("/")}`.slice(0, 200);
}

/** A call stopped before it left: nothing reached the provider. */
export class NotSent extends Error {}
/** A call this worker may never make (a host or method outside the list). */
export class LedgerRefused extends NotSent {}

/** Receipts that could not be written after their call had already left. */
export type LedgerState = { failures: number };

/**
 * A fetch that writes the ledger around each call. `state.failures` counts
 * receipts that could not be written after a call had already left (the
 * request is never repeated for them). worker.ts's `wire()` passes one
 * `state` to every ledger of a process (the providers, the old senders, the
 * doctor's WhatsApp health), and the run's health row reports it as
 * `detail.receiptsMissing` with a sentence in its note when above 0; the
 * doctor prints it and fails on it; G5's row carries it in its detail.
 */
export function ledgerFetch(opts: {
  insert: InsertReceipt;
  runKey: string;
  fetch?: typeof fetch;
  state?: LedgerState;
}) {
  const request = opts.fetch ?? fetch;
  const state = opts.state ?? { failures: 0 };
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url,
    );
    const provider = providerOf(url.host);
    if (!provider || url.protocol !== "https:")
      throw new LedgerRefused(
        "Only the named providers are called from this worker.",
      );
    const method = String(init?.method ?? "GET").toUpperCase();
    if (
      method !== "GET" &&
      !(
        method === "POST" &&
        (ALLOWED_POSTS as readonly string[]).includes(
          `${url.origin}${url.pathname}`,
        ) &&
        !url.search
      )
    ) {
      throw new LedgerRefused(
        "Only GET reads and the two named POSTs leave this worker.",
      );
    }
    const resource = resourceOf(url);
    const row = (phase: Receipt["phase"], status: number | null): Receipt => ({
      provider,
      method,
      resource,
      phase,
      http_status: status,
      object_id: null,
      action_id: null,
      run_key: opts.runKey,
    });
    // A caller's time limit already spent: the request would never leave.
    if (init?.signal?.aborted)
      throw new NotSent(
        "The call ran out of time before it left; it was not made.",
      );
    // No receipt, no request.
    try {
      await opts.insert(row("intent", null));
    } catch (e) {
      throw new NotSent(
        e instanceof Error && e.message
          ? e.message
          : "The intent receipt could not be written; the call was not made.",
      );
    }
    // The receipt can be slow: a limit spent while it was written stops the call here.
    if (init?.signal?.aborted)
      throw new NotSent(
        "The call ran out of time before it left; it was not made.",
      );
    let res: Response;
    try {
      res = await request(url.href, init);
    } catch (e) {
      await opts.insert(row("unknown", null)).catch(() => {
        state.failures += 1;
      });
      throw e;
    }
    await opts.insert(row("response", res.status)).catch(() => {
      state.failures += 1;
    });
    return res;
  }) as typeof fetch;
  return { fetch: wrapped, state };
}
