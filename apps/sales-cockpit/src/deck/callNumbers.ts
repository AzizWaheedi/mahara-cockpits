/**
 * Where the deck's prospect numbers come from: the call's saved notes, or
 * what the closer types on the numbers slide.
 *
 * The demo script saves as the closer types (script.save), and the deck is
 * often opened before the numbers part of the call, while the numbers slide
 * now sits near the deck's end (the CEO, 2026-10-10). So the deck reads the
 * call's notes again when one of these slides comes up.
 */

/** The four counts that make the funnel; two of them make it the call's. */
export const FUNNEL_FIELDS = [
  "leads_month",
  "booked_month",
  "showed_month",
  "closed_month",
] as const;

/** The slides that draw on the prospect's numbers. */
export const USES_CALL_NUMBERS = ["closing", "numbers"] as const;

const filled = (v: Record<string, string>, k: string) =>
  (v[k] ?? "").trim() !== "";

/**
 * The call's numbers win when it saved at least two of the four counts and
 * the closer has typed none on the slide: what was typed in front of the
 * prospect stays on screen when the call's notes land later.
 */
export function numbersFromCall(
  saved: Record<string, string>,
  typed: Record<string, string>,
): boolean {
  if (FUNNEL_FIELDS.some(k => filled(typed, k))) return false;
  return FUNNEL_FIELDS.filter(k => filled(saved, k)).length >= 2;
}
