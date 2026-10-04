// Pure helpers for tap-charges-sync, kept free of Deno APIs so they run under bun test.

/**
 * Tap answers a charges list for a window with no captured charges with HTTP 400 (body http_code 404)
 * and error 1249 "Charges not found". That is an empty page, not a failure. Before 4 Oct 2026 the
 * sync threw on it, so one quiet 30-day window stopped every run (guardian tap-charges, 6+ days).
 */
export function isEmptyChargesAnswer(status: number, text: string): boolean {
  if (status !== 400 && status !== 404) return false;
  try {
    const j = JSON.parse(text);
    const errs = Array.isArray(j?.errors) ? j.errors : [];
    return errs.length > 0 && errs.every((e: { code?: unknown }) => String(e?.code ?? "") === "1249");
  } catch {
    return false;
  }
}
