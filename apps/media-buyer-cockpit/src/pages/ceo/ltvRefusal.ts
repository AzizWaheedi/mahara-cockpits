/**
 * The LTV preview's refusal as one sentence for its card (R3, 2026-10-11),
 * with what happens next. The preview (`ltv.preview` in cockpit_ceo_action)
 * refuses for a few reasons, and only some clear by themselves:
 * - the finance totals are not reconciled, or Money is missing or stale:
 *   the next successful Money refresh fixes both;
 * - the client billing rows are stale: the next billing sync (every half
 *   hour in the day) fixes it;
 * - anything else (an invalid baseline, a refusal we do not know): it does
 *   not clear by itself, so the card says to queue it as a bug.
 * The card says so instead of taking the Money tab down. Pure, for
 * scripts/ceo-fixes-screens.test.ts.
 */
export function ltvRefusal(error: Error): string {
  const said = error.message
    .replace(/^.*Uncaught Error:\s*/s, "")
    .split("\n")[0]
    .trim()
    .replace(/\.+$/, "")
    .slice(0, 240);
  const next = /finance totals|money attribution/i.test(said)
    ? "It clears by itself after the next successful Money refresh."
    : /billing/i.test(said)
      ? "It clears by itself after the next billing sync, every half hour in the day."
      : "It will not clear by itself: queue it as a bug under Changes and bugs on the Machine tab.";
  return `${said || "The preview was refused"}. ${next}`;
}
