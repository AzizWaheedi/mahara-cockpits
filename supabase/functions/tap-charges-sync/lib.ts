// Pure helpers for tap-charges-sync, kept apart from index.ts so they can be
// tested without the Supabase runtime (bun test supabase/functions/tap-charges-sync).

// Tap answers POST /v2/charges/list for a date window that holds no charges
// with an error instead of an empty list: HTTP 400 and
// {"errors":[{"code":"1249","description":"Charges not found"}]}.
// That is an empty window, not a failure. Any other error stays an error.
export function isNoChargesAnswer(status: number, text: string): boolean {
  if (status < 400 || status >= 500) return false;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return false;
  }
  const errors = (json as { errors?: unknown })?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return false;
  return errors.every(e => String((e as { code?: unknown })?.code ?? "").trim() === "1249");
}
