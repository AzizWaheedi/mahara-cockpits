// Internal relays do not represent a chat message in a child cockpit.
// Passing their display key to chatReading fails Convex's v.id validator.
export function shouldMarkThreadReading(app: string): boolean {
  return app === "local" || app === "csm" || app === "creative";
}
