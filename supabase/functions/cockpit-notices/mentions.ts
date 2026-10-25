/**
 * Who a notice tags (plan 1.3, contract 3.9 and 4.3). The database resolves
 * each settings row's seat rules and named people to Mention rows when it
 * claims a notice, so a change in Settings applies to the next notice. Here
 * the sender picks the list for the variant, fills a missing Slack id from
 * users.lookupByEmail, and falls back to the role label in plain text. The
 * email is used for that lookup only: it never goes into facts, text,
 * receipts or a response.
 */
import type { TextMention, Variant } from "./text.ts";

export type Mention = {
  rule: string;
  personId?: number | null;
  label?: string | null;
  slackId?: string | null;
  email?: string | null;
  missing?: boolean;
};
export type ClaimMentions = { main?: Mention[]; late?: Mention[]; second?: Mention[] };
export type LookupResult = { state: "ok"; id: string } | { state: "not_found" } | { state: "refused"; code: string } | { state: "unknown" };
export type Lookup = (email: string) => Promise<LookupResult>;

const SLACK_ID = /^[UW][A-Z0-9]{8,12}$/;
const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[a-z]{2,24}$/i;

export const RULE_LABEL: Record<string, string> = {
  "seat:creative": "the creative director",
  "seat:csm": "the CSM",
  "seat:systems_manager": "the systems manager",
  people: "a named person",
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** One Mention from the database, kept to its known keys. */
export function readMention(v: unknown): Mention | null {
  if (!isObj(v)) return null;
  const rule = typeof v.rule === "string" ? v.rule : "people";
  return {
    rule,
    personId: typeof v.personId === "number" && Number.isInteger(v.personId) ? v.personId : null,
    label: typeof v.label === "string" && v.label.trim() ? v.label.trim().slice(0, 80) : null,
    slackId: typeof v.slackId === "string" && SLACK_ID.test(v.slackId) ? v.slackId : null,
    email: typeof v.email === "string" && EMAIL.test(v.email.trim()) ? v.email.trim().toLowerCase() : null,
    missing: v.missing === true,
  };
}

const list = (v: unknown): Mention[] => (Array.isArray(v) ? v.map(readMention).filter((m): m is Mention => m !== null) : []);

/** The role label a mention shows when it is not a tag. */
export const labelOf = (m: Mention): string => m.label ?? RULE_LABEL[m.rule] ?? "a team member";

/**
 * The tags for a variant, in order and deduped by person: complete, `main`
 * then `second` when it is a second kickoff; late, `late` then `second`;
 * everything else `main`. An array (a dry run's inputs) is taken as `main`.
 */
export function mentionsFor(variant: Variant | null, mentions: ClaimMentions | Mention[] | null | undefined, second: boolean): Mention[] {
  const m: ClaimMentions = Array.isArray(mentions) ? { main: mentions } : isObj(mentions) ? mentions : {};
  const picked =
    variant === "complete" ? [...list(m.main), ...(second ? list(m.second) : [])]
    : variant === "late" ? [...list(m.late), ...(second ? list(m.second) : [])]
    : list(m.main);
  const seen = new Set<string>();
  const out: Mention[] = [];
  for (const x of picked) {
    const key = x.missing ? `missing:${x.rule}` : x.personId !== null && x.personId !== undefined ? `p:${x.personId}` : x.slackId ? `s:${x.slackId}` : x.email ? `e:${x.email}` : `l:${x.rule}:${labelOf(x)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(x);
  }
  return out;
}

/** A lookup that asks Slack once per email in a run. */
export function cachedLookup(lookup: Lookup): Lookup {
  const seen = new Map<string, Promise<LookupResult>>();
  return email => {
    const key = email.toLowerCase();
    let p = seen.get(key);
    if (!p) {
      p = lookup(key).catch(() => ({ state: "unknown" }) as LookupResult);
      seen.set(key, p);
    }
    return p;
  };
}

export type Resolved = {
  tags: TextMention[];
  report: { rule: string; label: string; tagged: boolean }[];
  /** Mentions that go out as plain text: no Slack id, or a rule that found nobody. */
  unresolved: number;
};

/** Fill missing Slack ids by email (when a lookup is given); anything still without one is its role label in plain text. */
export async function resolveMentions(mentions: Mention[], lookup: Lookup | null): Promise<Resolved> {
  const tags: TextMention[] = [];
  const report: Resolved["report"] = [];
  let unresolved = 0;
  for (const m of mentions) {
    let id = m.slackId ?? null;
    if (!id && !m.missing && m.email && lookup) {
      const found = await lookup(m.email);
      if (found.state === "ok") id = found.id;
    }
    const label = labelOf(m);
    if (!id) unresolved += 1;
    tags.push({ label, slackId: id });
    report.push({ rule: m.rule, label, tagged: !!id });
  }
  return { tags, report, unresolved };
}

/** For a test post: who it would tag, as plain labels. */
export const plainLabels = (mentions: Mention[]): TextMention[] => mentions.map(m => ({ label: labelOf(m), slackId: null }));
