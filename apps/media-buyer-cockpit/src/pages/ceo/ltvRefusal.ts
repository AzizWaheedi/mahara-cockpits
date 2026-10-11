/**
 * The LTV preview's refusal as one sentence for its card (R3, 2026-10-11).
 * The preview refuses until the finance totals are reconciled and Money is
 * fresh; that clears on its own, so the card says so instead of taking the
 * Money tab down. Pure, for scripts/ceo-fixes-screens.test.ts.
 */
export function ltvRefusal(error: Error): string {
  const said = error.message
    .replace(/^.*Uncaught Error:\s*/s, "")
    .split("\n")[0]
    .trim()
    .replace(/\.+$/, "")
    .slice(0, 240);
  return `${said || "The preview was refused"}. It clears by itself after the next successful Money refresh.`;
}
