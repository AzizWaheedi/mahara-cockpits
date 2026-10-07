type Charge = Record<string, unknown>;

/** Tap reports an empty captured-charge window as HTTP 400 / code 1249. */
export function parseTapChargePage(
  status: number,
  text: string,
): { charges: Charge[]; hasMore: boolean } {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    if (status < 200 || status >= 300)
      throw new Error(`Tap returned HTTP ${status}: invalid JSON`);
    throw new Error("Tap returned invalid JSON");
  }
  const result = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (status < 200 || status >= 300) {
    const errors = Array.isArray(result.errors) ? result.errors : [];
    if (status === 400 && errors.length > 0 && errors.every(
      e => e && typeof e === "object" && String((e as Record<string, unknown>).code) === "1249",
    )) return { charges: [], hasMore: false };
    const codes = errors.map(e => e && typeof e === "object" ? String((e as Record<string, unknown>).code) : "unknown");
    throw new Error(`Tap returned HTTP ${status}${codes.length ? ` (codes: ${codes.join(",")})` : ""}`);
  }
  if (!Array.isArray(result.charges))
    throw new Error("Tap returned a success response without a charges array");
  return { charges: result.charges as Charge[], hasMore: result.has_more === true };
}
