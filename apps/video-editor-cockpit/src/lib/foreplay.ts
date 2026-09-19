/**
 * Where to send somebody in Foreplay.
 *
 * Their app cannot be embedded: foreplay.co answers with
 * `content-security-policy: frame-ancestors 'self'`, so an iframe of
 * discovery renders an empty box in any cockpit. Links in a new tab are the
 * whole of what is possible, and they are enough: everyone on the team is
 * signed in there already, so a link lands on the real page.
 *
 * The paths are their router's own, read off app.foreplay.co's bundle on
 * 2026-09-19, not guessed. Their word for the swipe file is "library".
 */
const APP = "https://app.foreplay.co";

export const foreplay = {
  /** Every ad their crawler has, searchable. The reason to leave the cockpit. */
  discovery: `${APP}/discovery`,
  /** Discovery narrowed to advertisers rather than single ads. */
  brands: `${APP}/discovery-brands`,
  /** Everything the team has saved. */
  library: `${APP}/library`,
  /** Saves by teammate, which is how you see who is actually collecting. */
  team: `${APP}/library-team`,
  /** The boards themselves. */
  boards: `${APP}/boards`,
  /** Brands we follow, so their new ads arrive without anyone looking. */
  spyder: `${APP}/spyder`,
  /** How to save an ad from a phone: the setup page for the team. */
  onPhone: `${APP}/library-mobile-saving`,
  /** One board. */
  board: (id: string) => `${APP}/boards/${encodeURIComponent(id)}`,
} as const;
