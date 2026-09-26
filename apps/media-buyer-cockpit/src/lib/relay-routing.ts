/** Only cockpit chat relays have a chat document to mark as reading.
 * Draft/fix relays have synthetic message IDs and must stay in the local relay ledger.
 */
export function hasThreadReadingState(app: string): boolean {
  return app === "local" || app === "csm" || app === "creative";
}
