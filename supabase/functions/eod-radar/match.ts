/**
 * Who a Name line means (pure, for the tests). Never a guess across two
 * people: a name that fits more than one person is narrowed by the channel
 * the post is in, then by the form's header ("VIDEO EDITOR EOD"), and if it
 * still fits two it credits nobody and is reported as unmatched.
 *
 * A name fits a person when every word of it is a word of their roster name
 * ("Nada" -> Nada Al Saed, "rasem abdel all" -> Rasem Abdel All), or when its
 * words run together are their email's local part ("Ahmed Abushaiba" ->
 * ahmedabushaiba@, the roster spells him Abusahiba), or their whole name run
 * together ("Muhammed Burhan" -> "muhammedburhan").
 */

export type Person = {
  personId: number;
  name: string;
  email: string | null;
  role: string | null;
  /** The EOD channel the person's role files in. */
  channel: string | null;
  channelName: string | null;
  slackUserId: string | null;
};

export type NameMatch = { kind: "one"; person: Person } | { kind: "many"; people: Person[] } | { kind: "none" };

/** Lower-case words, accents dropped, anything that is not a letter or a digit a break. */
export function nameWords(s: string | null | undefined): string[] {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const localPart = (email: string | null) => (email ? nameWords(email.split("@")[0]).join("") : "");

export function fits(person: Person, text: string): boolean {
  const words = nameWords(text);
  if (!words.length) return false;
  const own = nameWords(person.name);
  const joined = words.join("");
  if (words.every(w => own.includes(w))) return true;
  if (joined.length >= 4 && joined === localPart(person.email)) return true;
  return words.length >= 2 && joined === own.join("");
}

/** Form headers and the roles they belong to. */
const HEADER_ROLES: [RegExp, RegExp][] = [
  [/video\s*edit/i, /video\s*edit/i],
  [/creative/i, /creative/i],
  [/media\s*buy/i, /media\s*buy/i],
  [/client\s*success|account\s*manag|\bcsm\b/i, /client\s*success|account\s*manag|\bcsm\b/i],
  [/sales|closer|setter/i, /closer|setter|sales/i],
  [/\bcsr\b|call\s*cent/i, /call\s*cent(re|er)|\bcsr\b/i],
  [/systems?\s*manag|\btech\b/i, /systems?\s*manag|web\s*develop/i],
];

/** Whether a form's header ("VIDEO EDITOR", "CSR", "SALES REP") is the person's role. */
export function headerFits(header: string | null | undefined, role: string | null): boolean {
  if (!header || !role) return false;
  return HEADER_ROLES.some(([h, r]) => h.test(header) && r.test(role));
}

/** The person a name means, narrowed by channel and then by the form's header. */
export function matchName(people: Person[], text: string | null | undefined, hint: { channel?: string | null; header?: string | null } = {}): NameMatch {
  if (!text) return { kind: "none" };
  let found = people.filter(p => fits(p, text));
  if (found.length > 1 && hint.channel) {
    const inChannel = found.filter(p => p.channel === hint.channel);
    if (inChannel.length) found = inChannel;
  }
  if (found.length > 1 && hint.header) {
    const byRole = found.filter(p => headerFits(hint.header, p.role));
    if (byRole.length) found = byRole;
  }
  if (found.length === 1) return { kind: "one", person: found[0] };
  if (found.length > 1) return { kind: "many", people: found };
  return { kind: "none" };
}
