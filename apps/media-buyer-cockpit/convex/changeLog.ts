/**
 * Where a media buyer change goes after Meta: the campaign's card on the ads
 * management board (ClickUp) and the client's card in the client success
 * cockpit. Pure rules, used by writeback.ts and csmSync.ts.
 *
 * Aziz, 2026-10-06: "the changes in the media buyer cockpit aren't syncing to
 * ClickUp; also all changes should update the client card in the CSM
 * cockpit". Until then only a typed change-log entry was written to ClickUp:
 * the on/off switches, budgets, copied ad sets, new ads, new creatives and
 * builds went to Meta and the cockpit and nowhere else, and the CSM's card
 * listed decisions only. 16 changes in two weeks, none on ClickUp.
 */

/** Notes that are not changes: a question to Aziz, anything asked. */
const QUIET = [/^Asked\b/i, /[?؟]\s*$/];

export function isChange(what: string): boolean {
  const text = String(what ?? "").trim();
  return text.length > 0 && !QUIET.some(q => q.test(text));
}

function tight(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

type Campaign = {
  campaignName: string;
  clientName?: string;
  clientTag?: string;
  taskId?: string;
  spend7d?: number;
};

/**
 * The board card a change belongs on. The campaign's own card first; then,
 * for a campaign with no card of its own or a build filed under the client's
 * name, the card of the client's biggest spender, since the board keeps one
 * card per client.
 */
export function cardFor<T extends Campaign>(
  campaignName: string,
  campaigns: T[],
): { taskId: string; ownCard: boolean; campaign?: T } | undefined {
  const own = campaigns.find(c => c.campaignName === campaignName);
  if (own?.taskId) return { taskId: own.taskId, ownCard: true, campaign: own };
  const keys = new Set(
    [campaignName, own?.clientName, own?.clientTag].map(tight).filter(Boolean),
  );
  const sibling = campaigns
    .filter(
      c =>
        c.taskId &&
        (keys.has(tight(c.clientName)) || keys.has(tight(c.clientTag))),
    )
    .sort((a, b) => (b.spend7d ?? 0) - (a.spend7d ?? 0))[0];
  return sibling?.taskId
    ? { taskId: sibling.taskId, ownCard: false, campaign: own }
    : undefined;
}

/** The comment on the card: who, on what, when, and what changed. */
export function changeComment(
  m: {
    by: string;
    campaignName: string;
    adName?: string;
    what: string;
    at: number;
  },
  now = Date.now(),
): string {
  const who =
    !m.by || m.by === "cockpit" || m.by === "Built from the cockpit"
      ? "the media buyer"
      : m.by;
  const day = new Date(m.at + 3 * 3_600_000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  // A change posted late (ClickUp was down, or it was missed) says so by its
  // date, and is not given a judging clock that has already run.
  const fresh = now - m.at < 86_400_000;
  return [
    `🎯 Cockpit · CHANGE MADE — ${m.what}`,
    "",
    m.adName ? `${m.campaignName} · ${m.adName}` : m.campaignName,
    "",
    `Made by ${who} in the Media Buyer Cockpit on ${day}.${fresh ? " Three days before this is judged." : ""}`,
  ].join("\n");
}

/** At most one letter apart: "acturus construction" is "arcturus construction". */
function nearlySame(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 8 || Math.abs(a.length - b.length) > 1)
    return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  // One substitution, one insertion or one deletion at the first difference.
  return (
    a.slice(i + 1) === b.slice(i + 1) ||
    a.slice(i) === b.slice(i + 1) ||
    a.slice(i + 1) === b.slice(i)
  );
}

/**
 * Whether a campaign's client (Client Data's name for it) is this card. By
 * the card's name or any of its aliases (clientLinks), forgiving one letter,
 * because the sheet calls Arcturus "Acturus Construction" and the exact
 * match left its changes off the card.
 */
export function isClientOf(
  clientName: string | undefined,
  card: { name: string; aliases?: string[] },
): boolean {
  const mine = tight(clientName);
  if (!mine) return false;
  return [card.name, ...(card.aliases ?? [])]
    .map(tight)
    .filter(Boolean)
    .some(n => nearlySame(mine, n));
}

/**
 * The board's Ad Status after a campaign is switched in Meta. Undefined when
 * the board already says so, or says something stronger (a dead campaign
 * stays dead when it is paused).
 */
export function boardStatusAfter(
  metaStatus: string | undefined,
  boardStatus: string | undefined,
): "Live" | "Paused" | undefined {
  const board = String(boardStatus ?? "");
  if (metaStatus === "ACTIVE") return board === "Live" ? undefined : "Live";
  if (metaStatus === "PAUSED")
    return ["Paused", "Dead Campaign", "Lost Client"].includes(board)
      ? undefined
      : "Paused";
  return undefined;
}

export type CardChange = {
  subject: string;
  action: string;
  kind: string;
  evidence: string;
  day: string;
  at: number;
  taskUrl?: string;
};

/**
 * The changes one client's card shows: on any of the client's campaigns, or
 * filed under the client's own name (a build), since the last call when
 * there was one, or the last 14 days. Newest first.
 */
export function changesForCard(
  all: CardChange[],
  client: { name: string; campaigns: string[]; lastCallAt?: number },
  now: number,
  max = 8,
): CardChange[] {
  const names = new Set(client.campaigns);
  const own = tight(client.name);
  const since = client.lastCallAt ?? now - 14 * 86_400_000;
  return all
    .filter(
      c => c.at >= since && (names.has(c.subject) || tight(c.subject) === own),
    )
    .sort((a, b) => b.at - a.at)
    .slice(0, max);
}
