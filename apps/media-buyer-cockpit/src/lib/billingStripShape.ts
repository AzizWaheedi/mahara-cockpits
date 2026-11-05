/**
 * Whether the Payments strip showed on the last Today or Ads load. The two
 * page skeletons draw its space when it did, so the page does not jump when
 * the strip appears.
 */

const KEY = "mahara-billing-strip-shown";

export function readBillingStripShown(): boolean {
  try {
    return localStorage.getItem(KEY) === "true";
  } catch {
    return false;
  }
}

export function writeBillingStripShown(shown: boolean): void {
  try {
    localStorage.setItem(KEY, shown ? "true" : "false");
  } catch {
    // Storage is off. The next skeleton draws no strip.
  }
}
