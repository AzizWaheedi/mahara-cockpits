import type { SupabaseClient } from "@supabase/supabase-js";
import { money, shortDate } from "@/components/ceo/format";
import { type CpbShown, cpbDisplay } from "./costTone";

/**
 * One client's numbers over any range, from `cockpit_media_client_range`
 * (migration 20261022x, the cost per booking build of 22 Oct 2026, R8).
 *
 * The client page used to add up the campaigns the cockpit still lists, so
 * a stopped campaign's spend and bookings fell out of the client's totals:
 * Khalida's month to 20 Oct read $91.62 where the client spent $191.53, and
 * ARCWANI and Liwan, whose campaigns had all stopped, could not be opened at
 * all. The read counts the client the way the Client Performance board
 * does, by its ad accounts:
 * - spend and leads: Mahara's campaigns on the client's accounts (a campaign
 *   that has, or had, a card on the Ads Management board), stopped ones
 *   included, one row per ad and day; the rest of the account is
 *   `offBoardSpend` and ads on the compromise list are `excludedSpend`, both
 *   left out and named;
 * - bookings: the board's confirmed count for the client's location over
 *   the same days (main and online calendars), null with the reason when a
 *   day is not stored or the client books its own meetings (Done with you);
 *   `mediaBookings` is the media sync's count of the same campaigns and days,
 *   the second source;
 * - every figure counts from `countedFrom`, the first day the sources vouch
 *   for (the day after the cockpit's campaign list was first imported, 24 Sep
 *   2026), and stops on `through`, the paired day (cockpit_media_week()), so
 *   spend and bookings cover the same days; `why` says so when either cuts
 *   the range short.
 * Missing is never zero: a figure the read could not know is null.
 */

export type ClientRangeCampaign = {
  campaignName: string;
  spend: number | null;
  leads: number | null;
  bookings: number | null;
  /** The campaign is still on the cockpit's list. */
  live: boolean;
};

export type ClientRangeRow = {
  clickupId: string | null;
  locationId: string | null;
  name: string;
  serviceMode: string | null;
  status: string | null;
  /** Meta ad account ids, digits only. */
  accounts: string[];
  spend: number | null;
  leads: number | null;
  offBoardSpend: number | null;
  excludedSpend: number | null;
  campaigns: ClientRangeCampaign[];
  bookings: number | null;
  days: number | null;
  storedDays: number | null;
  mediaBookings: number | null;
  costPerBooking: number | null;
  /** Why a figure is null, in one plain sentence. */
  why: string | null;
};

export type ClientRangeRead = {
  from: string;
  to: string;
  /**
   * The first day counted: the range's start, or the first day the sources
   * vouch for when the range starts before it. Null when no day is counted.
   */
  countedFrom: string | null;
  /** The last day counted: the range's end, or the paired day before it. */
  through: string | null;
  throughSource: string | null;
  clients: ClientRangeRow[];
  unmatched: { account: string; campaigns: string[]; spend: number | null }[];
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

const day = (v: unknown): string | null =>
  typeof v === "string" && DAY.test(v) ? v : null;

/** A Meta ad account id as the read keys it: digits, no "act_". */
export const accountKey = (v: unknown): string =>
  String(v ?? "")
    .trim()
    .replace(/^act_/i, "");

/** A client's name, for matching: letters and digits only, any script. */
export const nameKey = (v: unknown): string =>
  String(v ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

const SHAPE = "The client numbers came back in a shape this page cannot read.";

/** The read checked: a wrong shape throws, a missing figure stays null. */
export function parseClientRange(data: unknown): ClientRangeRead {
  const d = data as Record<string, unknown> | null;
  if (!d || typeof d !== "object" || !Array.isArray(d.clients))
    throw new Error(SHAPE);
  const from = day(d.from);
  const to = day(d.to);
  if (!from || !to) throw new Error(SHAPE);
  const clients = (d.clients as Record<string, unknown>[]).map(c => {
    if (!c || typeof c !== "object") throw new Error(SHAPE);
    const campaigns = Array.isArray(c.campaigns)
      ? (c.campaigns as Record<string, unknown>[])
          .filter(x => x && typeof x === "object" && text(x.campaignName))
          .map(x => ({
            campaignName: String(x.campaignName),
            spend: num(x.spend),
            leads: num(x.leads),
            bookings: num(x.bookings),
            live: x.live === true,
          }))
      : [];
    return {
      clickupId: text(c.clickupId),
      locationId: text(c.locationId),
      name: text(c.name) ?? "Unnamed client",
      serviceMode: text(c.serviceMode),
      status: text(c.status),
      accounts: Array.isArray(c.accounts)
        ? [...new Set(c.accounts.map(accountKey).filter(Boolean))]
        : [],
      spend: num(c.spend),
      leads: num(c.leads),
      offBoardSpend: num(c.offBoardSpend),
      excludedSpend: num(c.excludedSpend),
      campaigns,
      bookings: num(c.bookings),
      days: num(c.days),
      storedDays: num(c.storedDays),
      mediaBookings: num(c.mediaBookings),
      costPerBooking: num(c.costPerBooking),
      why: text(c.why),
    };
  });
  const unmatched = Array.isArray(d.unmatched)
    ? (d.unmatched as Record<string, unknown>[])
        .filter(u => u && typeof u === "object")
        .map(u => ({
          account: accountKey(u.account),
          campaigns: Array.isArray(u.campaigns) ? u.campaigns.map(String) : [],
          spend: num(u.spend),
        }))
    : [];
  return {
    from,
    to,
    countedFrom: day(d.countedFrom),
    through: day(d.through),
    throughSource: text(d.throughSource),
    clients,
    unmatched,
  };
}

/**
 * One read over a range. `accounts` narrows it to those ad accounts; none
 * reads every client this seat may see that spent or booked in the range.
 */
export async function readClientRange(
  client: SupabaseClient,
  args: { start: string; end: string; accounts?: unknown[] | null },
): Promise<ClientRangeRead> {
  const accounts = [
    ...new Set((args.accounts ?? []).map(accountKey).filter(Boolean)),
  ].sort();
  const { data, error } = await client.rpc("cockpit_media_client_range", {
    p_start: args.start,
    p_end: args.end,
    p_accounts: accounts.length > 0 ? accounts : null,
  });
  if (error) throw new Error(error.message);
  return parseClientRange(data);
}

/**
 * The row counts at least one day of the range, so its figures are the
 * client's. A range wholly after the paired day (Today, before the nightly
 * pull) or wholly before the first day the sources vouch for counts none:
 * every figure is null, and the page keeps the campaigns' own reads.
 */
export function countsDays(
  row: ClientRangeRow | undefined,
): row is ClientRangeRow {
  return Boolean(row && row.days !== null && row.days > 0);
}

/**
 * The client's cost per booking as the page shows it: the read's own figure,
 * or no booking after spend as the grid shows it (cpbDisplay). Bookings and
 * spend both above 0 with no cost from the read means the read could not set
 * them against each other (Meta holds spend on Mahara's campaigns for days
 * the media data does not): n/a with the read's reason, never the partial
 * spend divided.
 */
export function clientCpb(row: ClientRangeRow): CpbShown {
  // Spend not known (no ad account of its own, or one counted under another
  // client): n/a with the read's own reason, never "None yet".
  if (row.spend === null)
    return {
      ...cpbDisplay(null, null),
      why: row.why ?? "This client's spend is not known for these days.",
    };
  if (
    row.bookings !== null &&
    row.bookings > 0 &&
    (row.spend ?? 0) > 0 &&
    row.costPerBooking === null
  )
    return {
      ...cpbDisplay(null, null),
      why:
        row.why ??
        "The cost per booking could not be worked out for these days.",
    };
  return cpbDisplay(row.spend, row.bookings, { cost: row.costPerBooking });
}

/**
 * The read's row for a client: by a shared ad account first (the name on
 * the cockpit's cards and on the board can differ), the name breaking a
 * tie; by name when no account is known.
 */
export function clientRowFor(
  read: ClientRangeRead | undefined,
  who: { name: string; accounts?: unknown[] },
): ClientRangeRow | undefined {
  if (!read) return undefined;
  const key = nameKey(who.name);
  const mine = new Set((who.accounts ?? []).map(accountKey).filter(Boolean));
  if (mine.size > 0) {
    const shared = read.clients.filter(c => c.accounts.some(a => mine.has(a)));
    if (shared.length > 0)
      return shared.find(c => nameKey(c.name) === key) ?? shared[0];
  }
  return key ? read.clients.find(c => nameKey(c.name) === key) : undefined;
}

/**
 * The clients that spent or booked in the range with no campaign among
 * `campaigns` (the board's running list): every campaign stopped, so the
 * board had no row to open them from (ARCWANI and Liwan, 1 to 20 Oct).
 * Biggest spend first.
 */
export function clientsWithoutCampaigns(
  read: ClientRangeRead | undefined,
  campaigns: {
    clientName?: unknown;
    accountName?: unknown;
    metaAccountId?: unknown;
  }[],
): ClientRangeRow[] {
  if (!read) return [];
  const accounts = new Set(
    campaigns.map(c => accountKey(c.metaAccountId)).filter(Boolean),
  );
  const names = new Set(
    campaigns.map(c => nameKey(c.clientName ?? c.accountName)).filter(Boolean),
  );
  return read.clients
    .filter(
      r =>
        ((r.spend ?? 0) > 0 || (r.bookings ?? 0) > 0) &&
        !r.accounts.some(a => accounts.has(a)) &&
        !names.has(nameKey(r.name)),
    )
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
}

/** The campaigns in the read that are not among the ones listed. */
export function campaignsNotListed(
  row: ClientRangeRow | undefined,
  listed: string[],
): ClientRangeCampaign[] {
  if (!row) return [];
  const names = new Set(listed);
  return row.campaigns
    .filter(c => !names.has(c.campaignName))
    .filter(
      c => (c.spend ?? 0) > 0 || (c.leads ?? 0) > 0 || (c.bookings ?? 0) > 0,
    )
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
}

/** The read's sentences about bookings alone (20261022x `why`). */
const BOOKING_ONLY = [
  "Done with you: the client books its own meetings.",
  "The media sync's booking history is not imported yet, so its count is not shown.",
];

/**
 * What the client's totals count and leave out, one sentence each, for the
 * line under the numbers: Mahara's campaigns against the board's whole
 * account (the CEO's default for Shades' pre-launch spend, D0d), where the
 * bookings come from, and the second source when it disagrees.
 */
export function clientRangeNotes(
  row: ClientRangeRow,
  options: { leadsOnly?: boolean; unlinked?: UnlinkedSpend } = {},
): string[] {
  const out = [
    "Mahara's campaigns only, stopped ones included; the Client Performance board counts the whole ad account.",
  ];
  if ((row.offBoardSpend ?? 0) > 0)
    out.push(
      `${money(row.offBoardSpend)} spent on the same ad account outside Mahara's campaigns is left out.`,
    );
  if ((row.excludedSpend ?? 0) > 0)
    out.push(
      `${money(row.excludedSpend)} on ads on the compromise list is left out.`,
    );
  if (options.unlinked) out.push(unlinkedText(options.unlinked));
  if (!options.leadsOnly && row.bookings !== null) {
    out.push(
      "Bookings are the board's confirmed count for these days: main and online calendars, from every campaign.",
    );
    if (row.mediaBookings !== null && row.mediaBookings !== row.bookings)
      out.push(
        `The media sync counts ${row.mediaBookings} for these campaigns and days.`,
      );
  }
  // Done with you: the bookings are the client's own, so their reasons are
  // not news on a page that shows no booking figure; the rest of `why` (the
  // days counted, the spend not known) still is.
  const why = options.leadsOnly
    ? BOOKING_ONLY.reduce((w, s) => w.replace(s, ""), row.why ?? "")
        .replace(/\s+/g, " ")
        .trim()
    : row.why;
  if (why) out.push(why);
  return out;
}

/** "Counted to 20 Oct" when the read stops before the range's end. */
export function countedTo(
  read: ClientRangeRead | undefined,
  end: string,
): string | undefined {
  return read?.through && read.through < end ? read.through : undefined;
}

/** "24 Sep 2026": a first day counted, with its year (a range can span years). */
export function dayWithYear(day: string): string {
  return `${shortDate(day)} ${day.slice(0, 4)}`;
}

/** "a", "a and b", "a, b and c". */
function listText(items: string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** Mahara's spend on ad accounts the Client Performance board links to no client. */
export type UnlinkedSpend = { spend: number; accounts: string[] };

function unlinkedText(u: UnlinkedSpend): string {
  const one = u.accounts.length === 1;
  return `${money(u.spend)} that Mahara's campaigns spent on ad account${one ? "" : "s"} ${listText(u.accounts)} is left out: ${one ? "it is" : "they are"} not linked to a client on the Client Performance board.`;
}

/**
 * Spend by Mahara's campaigns on the page's own ad accounts that no client on
 * the Client Performance board links (the read's `unmatched`). The client's
 * totals count the accounts the board links, so a campaign moved to an
 * account the board has not linked yet drops out of them; the page names
 * that spend instead of leaving it out without a word.
 */
export function unlinkedSpend(
  read: ClientRangeRead | undefined,
  row: ClientRangeRow | undefined,
  accounts: unknown[],
): UnlinkedSpend | undefined {
  if (!read || !row) return undefined;
  const mine = new Set(accounts.map(accountKey).filter(Boolean));
  const linked = new Set(row.accounts);
  const hits = read.unmatched.filter(
    u => mine.has(u.account) && !linked.has(u.account) && (u.spend ?? 0) > 0,
  );
  if (hits.length === 0) return undefined;
  return {
    spend: Math.round(hits.reduce((t, u) => t + (u.spend ?? 0), 0) * 100) / 100,
    accounts: hits.map(u => u.account).sort(),
  };
}

/**
 * Whose figures a client's page totals, and why in words when they are not
 * the client's own (R8, 2026-10-22).
 * - The client's read counts days of the range: its figures, unless the read
 *   starts later than the range (`countedFrom`, 24 Sep 2026, the first day
 *   the cockpit's campaign list can tell Mahara's campaigns from the
 *   client's own) while campaigns are listed. The daily charts, the ad wall
 *   and the campaign rows cover the whole range, so the totals must too:
 *   the campaigns listed are summed over it and the page says why. Read the
 *   other way, "Last month" in October gave Ocean Home $289.34 / 5 for 24 to
 *   30 Sep beside its only campaign's $858.71 and 17 bookings for the month.
 * - With no campaign listed the read is all the page has: its figures, with
 *   the days it counts named.
 * - Otherwise the campaigns listed are summed, and `why` says why: the read
 *   failed, counts no day of the range, or has no row for the client.
 * `why` is empty while the read is on its way, and with `whole`.
 */
export type ClientPagePlan = {
  /** The read's row for the client, whether or not it counts the range. */
  row?: ClientRangeRow;
  /** The row whose figures are the page's totals. */
  whole?: ClientRangeRow;
  /** With `whole`: its first day, when after the range's start. */
  countedFrom?: string;
  /** With `whole`: its last day, when before the range's end. */
  countedTo?: string;
  /** With `whole`: spend on the page's accounts the board does not link. */
  unlinked?: UnlinkedSpend;
  /** Without `whole`: why the totals are not the client's own. */
  why: string;
};

export function clientPagePlan(p: {
  read: ClientRangeRead | undefined;
  /** The read failed. */
  failed: boolean;
  name: string;
  /** The ad accounts the page read by. */
  accounts: string[];
  /** How many campaigns the page lists. */
  listed: number;
  start: string;
  end: string;
}): ClientPagePlan {
  const row = clientRowFor(p.read, { name: p.name, accounts: p.accounts });
  const from =
    p.read?.countedFrom && p.read.countedFrom > p.start
      ? p.read.countedFrom
      : undefined;
  const listed = p.listed > 0;
  const counts = countsDays(row);
  if (counts && (!from || !listed))
    return {
      row,
      whole: row,
      countedFrom: from,
      countedTo: countedTo(p.read, p.end),
      unlinked: unlinkedSpend(p.read, row, p.accounts),
      why: "",
    };
  const summed = "These totals are the campaigns listed here.";
  let why: string;
  if (p.failed)
    why = listed
      ? "The client's own numbers could not be read, so these totals are the campaigns listed here. Reload to try again."
      : "The client's own numbers could not be read. Reload the page to try again.";
  else if (!p.read) why = listed ? summed : "";
  else if (counts && from)
    why = `The client's own numbers start on ${dayWithYear(from)}, so over a range that starts earlier these totals are the campaigns listed here.`;
  else if (row)
    why = row.why
      ? listed
        ? `${row.why} ${summed}`
        : row.why
      : listed
        ? summed
        : "The client's own read counts no day of this range.";
  else if (p.accounts.length > 0)
    why = listed
      ? "This client's ad accounts are not linked to a client on the Client Performance board, so these totals are the campaigns listed here."
      : "This client's ad accounts are not linked to a client on the Client Performance board, so its numbers cannot be read here.";
  else
    why = listed
      ? "This client is not on the Client Performance board's client list under this name, so these totals are the campaigns listed here."
      : "The client's own read lists a client only when Mahara's campaigns spent on its ad accounts or a booking is stored for these days, and it lists nothing for this one.";
  return { row, why };
}

/**
 * The days a client's totals count, when they are not the range picked:
 * from the read's first day, to the paired day, or both. Undefined when the
 * totals cover the range as picked.
 */
export function countedLine(
  what: string,
  from?: string,
  to?: string,
): string | undefined {
  if (from && to)
    return `${what} are counted from ${dayWithYear(from)}, the first day the client's own numbers cover, to ${shortDate(to)}, the last day every account's numbers are in.`;
  if (from)
    return `${what} are counted from ${dayWithYear(from)}, the first day the client's own numbers cover.`;
  if (to)
    return `${what} are counted to ${shortDate(to)}, the last day every account's numbers are in, so they cover the same days.`;
  return undefined;
}

/**
 * The span a read's figures cover, when it is not the range picked: "from 24
 * Sep 2026", "to 20 Oct", or both. Undefined when it is the range.
 */
export function countedSpan(
  read: ClientRangeRead | undefined,
  start: string,
  end: string,
): string | undefined {
  const from =
    read?.countedFrom && read.countedFrom > start
      ? read.countedFrom
      : undefined;
  const to = countedTo(read, end);
  if (!from && !to) return undefined;
  return [
    from ? `from ${dayWithYear(from)}` : "",
    to ? `to ${shortDate(to)}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

const ACCOUNT = /^\d{5,25}$/;

/**
 * The ad accounts a client's page was opened with (`?adAccounts=`), digits
 * only, sorted, at most 20: a client with no campaign listed keeps reading
 * its own accounts when the range changes, so a range it did not spend in
 * reads its zeros instead of losing the client.
 */
export function parseAdAccounts(v: string | null | undefined): string[] {
  return [
    ...new Set(
      String(v ?? "")
        .split(",")
        .map(accountKey)
        .filter(a => ACCOUNT.test(a)),
    ),
  ]
    .sort()
    .slice(0, 20);
}

/** The `?adAccounts=` value for a list of ad accounts; empty for none. */
export function adAccountsParam(accounts: unknown[]): string {
  return parseAdAccounts(accounts.map(accountKey).join(",")).join(",");
}
