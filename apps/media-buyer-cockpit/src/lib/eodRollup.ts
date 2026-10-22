import { money, shortDate } from "@/components/ceo/format";
import { belowKpi, CPB_GATE, CPL_GATE } from "./kpi";

/**
 * The end of day report's 7-day numbers, one figure per client (R16, the
 * cost per booking build of 22 Oct 2026).
 *
 * The report used to add up the campaigns the cockpit lists and write one
 * "out of KPI" line per campaign, each labelled with the client's name and
 * rounded to whole dollars: Khalida appeared twice, Castello read $225 (one
 * campaign) where the client's figure was $268.48, and a stopped campaign's
 * spend and bookings never reached the totals. The media sync now publishes
 * each client's own 7 days on its client card row (`clientLinks[].ads7d`,
 * the worker's `calculator.ts`): Mahara's campaigns on the client's ad
 * accounts, stopped ones included, against the confirmed bookings made on
 * the same days. Where a client has no such figure (an older publish, or a
 * client with no ad account) its listed campaigns are summed instead, and
 * the report says which it is.
 */

type Row = Record<string, any>;

/** One campaign inside a client's 7 days. */
export type ClientWeekCampaign = {
  campaignName: string;
  spend: number;
  leads: number;
  bookings: number | null;
  live: boolean;
};

/** A client's 7 days as the media sync publishes them (`ads7d`). */
export type ClientWeek = {
  from: string;
  through: string;
  accounts: string[];
  spend: number;
  leads: number;
  offBoardSpend: number | null;
  bookings: number | null;
  bookingsWhy?: string;
  costPerBooking: number | null;
  showed: number | null;
  noShows: number | null;
  due: number | null;
  campaigns: ClientWeekCampaign[];
  source: "media sync";
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const orNull = (v: unknown): number | null => (finite(v) ? v : null);

/**
 * A client card's `ads7d`, checked. Anything not in the published shape
 * reads as not published (undefined), so the caller falls back to what it
 * showed before, never to 0.
 */
export function readClientWeek(v: unknown): ClientWeek | undefined {
  const w = v as Row | null | undefined;
  if (!w || typeof w !== "object") return undefined;
  if (!DAY.test(String(w.from ?? "")) || !DAY.test(String(w.through ?? "")))
    return undefined;
  if (!finite(w.spend) || !finite(w.leads)) return undefined;
  if (w.bookings !== null && !finite(w.bookings)) return undefined;
  const campaigns = Array.isArray(w.campaigns)
    ? (w.campaigns as Row[])
        .filter(c => c && typeof c === "object" && c.campaignName)
        .map(c => ({
          campaignName: String(c.campaignName),
          spend: finite(c.spend) ? c.spend : 0,
          leads: finite(c.leads) ? c.leads : 0,
          bookings: orNull(c.bookings),
          live: c.live === true,
        }))
    : [];
  return {
    from: w.from,
    through: w.through,
    accounts: Array.isArray(w.accounts) ? w.accounts.map(String) : [],
    spend: w.spend,
    leads: w.leads,
    offBoardSpend: orNull(w.offBoardSpend),
    bookings: orNull(w.bookings),
    bookingsWhy:
      typeof w.bookingsWhy === "string" && w.bookingsWhy
        ? w.bookingsWhy
        : undefined,
    costPerBooking: orNull(w.costPerBooking),
    showed: orNull(w.showed),
    noShows: orNull(w.noShows),
    due: orNull(w.due),
    campaigns,
    source: "media sync",
  };
}

/**
 * The media sync says a client books its own meetings (Done with you) in
 * `bookingsWhy` (calculator.ts BOOKINGS_WHY.dwy); its client card carries no
 * service mode of its own.
 */
export function weekIsDwy(week: ClientWeek): boolean {
  return (
    week.bookings === null && /^Done with you\b/i.test(week.bookingsWhy ?? "")
  );
}

/** A client's links from the ClickUp client list, matched by name or alias. */
export function findClientLinks(list: Row[], name: string): Row | undefined {
  const key = name.trim().toLowerCase();
  const tight = key.replace(/[^a-z0-9؀-ۿ]+/g, "");
  return (
    list.find(l => String(l.name).trim().toLowerCase() === key) ??
    list.find(l =>
      (l.aliases ?? []).some(
        (a: string) => a === key || a.replace(/[^a-z0-9؀-ۿ]+/g, "") === tight,
      ),
    )
  );
}

const clientOf = (c: Row | undefined) =>
  String(c?.clientName ?? c?.accountName ?? "Unassigned");

/** One client's 7 days, as the report counts them. */
export type ClientFigure = {
  /** The name the report gives the client: the cards' own, else the client card's. */
  client: string;
  /** Its campaigns on the cockpit's list (never Mahara's own). */
  campaigns: Row[];
  /** The media sync's figure, when published. */
  week?: ClientWeek;
  spend: number;
  leads: number;
  /** Confirmed bookings; null when not read, never 0. */
  bookings: number | null;
  /** The spend the bookings are set against. */
  bookedSpend: number;
  /** Done with you: the client books its own meetings. */
  dwy: boolean;
  /** Spend on the same ad accounts outside Mahara's campaigns, left out. */
  offBoardSpend: number;
  source: "media sync" | "campaigns listed";
  /** Per campaign, to name the worst one. */
  rows: ClientWeekCampaign[];
};

/**
 * Every client's 7 days: one figure per client, from its published `ads7d`
 * where there is one, else its listed campaigns summed (bookings summed,
 * never the largest one; a campaign whose count was not read leaves its
 * spend out of the cost per booking). A client with an `ads7d` that spent
 * or booked and has no campaign listed any more is counted too. Mahara's own
 * campaigns are never in it.
 */
export function clientFigures(campaigns: Row[], links: Row[]): ClientFigure[] {
  const groups = new Map<string, Row[]>();
  const internal = new Set<string>();
  for (const c of campaigns) {
    if (c.internal) {
      internal.add(clientOf(c));
      continue;
    }
    const client = clientOf(c);
    groups.set(client, [...(groups.get(client) ?? []), c]);
  }
  // Two names on the cards for one client card ("Shades" and its legal
  // name) share one ads7d: count it once, under the first.
  const byLink = new Map<Row, ClientFigure>();
  const out: ClientFigure[] = [];
  for (const [client, list] of groups) {
    // By name, then by a shared ad account: a card name the client list
    // does not know must not leave its figure to be counted a second time.
    const accounts = new Set(
      list
        .map(c => String(c.metaAccountId ?? "").replace(/^act_/i, ""))
        .filter(Boolean),
    );
    const named = findClientLinks(links, client);
    const link =
      named && readClientWeek(named.ads7d)
        ? named
        : (links.find(l =>
            readClientWeek(l.ads7d)?.accounts.some(a =>
              accounts.has(String(a).replace(/^act_/i, "")),
            ),
          ) ?? named);
    const week = readClientWeek(link?.ads7d);
    const claimed = link && week ? byLink.get(link) : undefined;
    if (claimed) {
      claimed.campaigns.push(...list);
      continue;
    }
    const dwy = list.every(c => c.serviceMode === "DWY");
    const figure = week
      ? fromWeek(client, list, week, dwy)
      : fromCampaigns(client, list, dwy);
    if (link && week) byLink.set(link, figure);
    out.push(figure);
  }
  // Mahara's own client card is never a client's figure. A client found only
  // by its card (every campaign stopped) is done with you when the media
  // sync says so, as a listed one is by its campaigns: its spend counts in
  // the cost per booking the same way, never as "bookings not read".
  const ours = new Set(
    [...internal].map(name => findClientLinks(links, name)).filter(Boolean),
  );
  for (const link of links) {
    if (byLink.has(link) || ours.has(link)) continue;
    const week = readClientWeek(link.ads7d);
    if (!week || (week.spend <= 0 && (week.bookings ?? 0) <= 0)) continue;
    const figure = fromWeek(
      String(link.name ?? "Unnamed client"),
      [],
      week,
      weekIsDwy(week),
    );
    byLink.set(link, figure);
    out.push(figure);
  }
  return out;
}

function fromWeek(
  client: string,
  list: Row[],
  week: ClientWeek,
  dwy: boolean,
): ClientFigure {
  const bookings = dwy ? null : week.bookings;
  return {
    client,
    campaigns: [...list],
    week,
    spend: week.spend,
    leads: week.leads,
    bookings,
    bookedSpend: bookings === null ? 0 : week.spend,
    dwy,
    offBoardSpend: week.offBoardSpend ?? 0,
    source: "media sync",
    rows: week.campaigns,
  };
}

function fromCampaigns(
  client: string,
  list: Row[],
  dwy: boolean,
): ClientFigure {
  const num = (v: unknown) => (finite(v) ? v : 0);
  const known = dwy ? [] : list.filter(c => finite(c.bookings7d));
  return {
    client,
    campaigns: [...list],
    spend: list.reduce((t, c) => t + num(c.spend7d), 0),
    leads: list.reduce((t, c) => t + num(c.leads7d), 0),
    bookings:
      known.length > 0
        ? known.reduce((t, c) => t + Number(c.bookings7d), 0)
        : null,
    bookedSpend: known.reduce((t, c) => t + num(c.spend7d), 0),
    dwy,
    offBoardSpend: 0,
    source: "campaigns listed",
    rows: list.map(c => ({
      campaignName: String(c.campaignName),
      spend: num(c.spend7d),
      leads: num(c.leads7d),
      bookings: dwy || !finite(c.bookings7d) ? null : c.bookings7d,
      live: true,
    })),
  };
}

/** The figure the report reads for a client by its name on the cards. */
export function figureFor(
  figures: ClientFigure[],
  client: string,
): ClientFigure | undefined {
  return (
    figures.find(f => f.client === client) ??
    figures.find(f => f.campaigns.some(c => clientOf(c) === client))
  );
}

/**
 * The spend a client's cost per booking divides: all of it when its
 * bookings were read, all of it for a client that books its own (as the
 * Client Performance board and the CEO's Delivery count it), only the read
 * campaigns' when some were not read, none when no count was read.
 */
function costedSpend(f: ClientFigure): number {
  if (f.dwy) return f.spend;
  return f.bookings === null ? 0 : f.bookedSpend;
}

export type EodTotals = {
  spend: number;
  leads: number;
  bookings: number;
  /** Spend over bookings; null with no booking. */
  costPerBooking: number | null;
  /** Spend of clients whose bookings were not read, left out of the cost. */
  notRead: { clients: number; spend: number };
  offBoardSpend: number;
  /** The media sync's window, when every client's figure is its. */
  window?: { from: string; through: string };
  /** Clients whose figure is their listed campaigns summed. */
  fromCampaigns: number;
  clients: number;
};

export function eodTotals(figures: ClientFigure[]): EodTotals {
  let spend = 0;
  let leads = 0;
  let bookings = 0;
  let costed = 0;
  let offBoardSpend = 0;
  const notRead = { clients: 0, spend: 0 };
  for (const f of figures) {
    spend += f.spend;
    leads += f.leads;
    bookings += f.dwy ? 0 : (f.bookings ?? 0);
    costed += costedSpend(f);
    offBoardSpend += f.offBoardSpend;
    const left = f.spend - costedSpend(f);
    if (left > 0.004) {
      notRead.clients += 1;
      notRead.spend += left;
    }
  }
  const weeks = figures.map(f => f.week).filter(Boolean) as ClientWeek[];
  return {
    spend,
    leads,
    bookings,
    costPerBooking: bookings > 0 ? costed / bookings : null,
    notRead,
    offBoardSpend,
    window:
      weeks.length > 0
        ? {
            from: weeks.map(w => w.from).sort()[0],
            through: weeks
              .map(w => w.through)
              .sort()
              .at(-1) as string,
          }
        : undefined,
    fromCampaigns: figures.filter(f => f.source === "campaigns listed").length,
    clients: figures.length,
  };
}

/** "Bookings (7d): 49 · cost per booking $55.45", naming what it leaves out. */
export function bookingsLine(t: EodTotals): string {
  const left =
    t.notRead.clients > 0
      ? ` (${money(t.notRead.spend)} of ${t.notRead.clients === 1 ? "one client's" : `${t.notRead.clients} clients'`} spend is left out of the cost: their bookings were not read)`
      : "";
  return `Bookings (7d): ${t.bookings}${t.bookings > 0 ? ` · cost per booking ${money(t.costPerBooking)}` : ""}${left}`;
}

/** Where the 7-day numbers come from and what they leave out, in one line. */
export function sourceLine(t: EodTotals): string {
  const off =
    t.offBoardSpend > 0
      ? `, and ${money(t.offBoardSpend)} on the same ad accounts outside them is left out`
      : "";
  if (t.clients > 0 && t.fromCampaigns === t.clients)
    return "Source: the campaigns listed, last 7 days. A stopped campaign is left out with its spend and bookings.";
  const window = t.window
    ? `, ${shortDate(t.window.from)} to ${shortDate(t.window.through)}`
    : "";
  const some =
    t.fromCampaigns > 0
      ? ` For ${t.fromCampaigns === 1 ? "one client" : `${t.fromCampaigns} clients`} with no published figure, the campaigns listed are summed.`
      : "";
  return `Source: the media sync's client figures${window}. Mahara's campaigns only, stopped ones included${off}.${some}`;
}

/**
 * A campaign name as it sits inside an EOD line: no direction marks, and no
 * spaced dash, which the client brief would read as a list separator
 * ("منشاءت الخالده-mahara – 14\10" splits the line in two otherwise).
 */
export function cleanName(name: string): string {
  return name
    .replace(/[‎‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+[-–—]\s+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The client brief (clientBrief.ts) cuts a decision's evidence at 90
 * characters in its notes and at 80 in "the newest thing that happened".
 * A long campaign name in front of the reason pushed the reason's figures
 * past that cut ("... and $9" for "$9.98 a lead").
 */
export const EVIDENCE_FIT = 80;
/** The campaign's label never shrinks below this, so it still says which. */
const LABEL_MIN = 16;

/** `name` cut on a word to at most `max` characters, with "…" when cut. */
function shortLabel(name: string, max: number): string {
  if (name.length <= max) return name;
  let cut = name.slice(0, max - 1);
  // Never half a character outside the basic plane.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  const space = cut.lastIndexOf(" ");
  const word = space >= Math.floor(max / 2) ? cut.slice(0, space) : cut;
  return `${word.replace(/[\s|,;:.\-–]+$/u, "")}…`;
}

/**
 * A decision's evidence, "{campaign}: {reason}" (contract 2.11, R16): the
 * campaign first, so the reason never reads as the client's own figure,
 * with the campaign's name cleaned (cleanName) and, when the two do not fit
 * EVIDENCE_FIT, shortened on a word to the room the reason leaves (at least
 * LABEL_MIN). The reason is never cut; the decision's subject keeps the full
 * campaign name. No reason, no evidence.
 */
export function decisionEvidence(
  campaignName: string,
  reason: unknown,
): string | undefined {
  const why = typeof reason === "string" ? reason.trim() : "";
  if (!why) return undefined;
  const name = cleanName(campaignName);
  if (!name) return why;
  const room = Math.max(LABEL_MIN, EVIDENCE_FIT - 2 - why.length);
  return `${shortLabel(name, room)}: ${why}`;
}

/**
 * The campaign that costs most a booking, for a client with more than one
 * campaign in the window: the highest cost per booking, or no booking after
 * more than a booking's worth of spend (CPB_GATE), which counts as that
 * spend. Undefined when none is judged yet.
 */
export function worstCampaign(
  f: ClientFigure,
): { name: string; text: string } | undefined {
  const rows = f.rows.filter(r => r.spend > 0 || (r.bookings ?? 0) > 0);
  if (rows.length < 2) return undefined;
  let worst: { name: string; text: string; cost: number } | undefined;
  for (const r of rows) {
    if (r.bookings === null) continue;
    const cost =
      r.bookings > 0
        ? r.spend / r.bookings
        : r.spend > CPB_GATE
          ? r.spend
          : undefined;
    if (cost === undefined || r.spend <= 0) continue;
    if (worst && worst.cost >= cost) continue;
    worst = {
      name: cleanName(r.campaignName),
      text:
        r.bookings > 0
          ? `at ${money(cost)} a booking`
          : `no booking on ${money(r.spend)}`,
      cost,
    };
  }
  return worst && { name: worst.name, text: worst.text };
}

/** The client's 7-day CPL as the report writes it. */
function cplText(f: ClientFigure): string {
  return f.leads > 0 ? money(f.spend / f.leads) : "no leads";
}

/** The client's numbers judged the way the grid judges a campaign. */
export function clientBelowKpi(f: ClientFigure): boolean {
  const spend = f.dwy || f.bookings === null ? f.spend : f.bookedSpend;
  return belowKpi({
    spend7d: spend,
    leads7d: f.leads,
    cpl: f.leads > 0 ? f.spend / f.leads : undefined,
    bookings7d: f.dwy ? null : f.bookings,
  });
}

/** The next step: the worst campaign's first fix, else any listed campaign's. */
function nextStep(f: ClientFigure, worst?: string): string {
  const byName = worst
    ? f.campaigns.find(c => cleanName(String(c.campaignName)) === worst)
    : undefined;
  const ordered = [
    ...(byName ? [byName] : []),
    ...[...f.campaigns].sort(
      (a, b) => Number(b.spend7d ?? 0) - Number(a.spend7d ?? 0),
    ),
  ];
  for (const c of ordered) {
    const fix = c?.findings?.[0]?.fixes?.[0];
    if (typeof fix === "string" && fix) return fix;
  }
  return "watching it";
}

/**
 * The clients out of KPI, one "• client - metric → next action" line each,
 * on the client's own figure with its worst campaign named. The client's
 * name stays first: the client brief (clientBrief.ts eodParts) keys on it.
 */
export function outOfKpiLines(figures: ClientFigure[], limit = 8): string[] {
  return figures
    .filter(clientBelowKpi)
    .slice(0, limit)
    .map(f => {
      const spend = f.bookings === null ? f.spend : f.bookedSpend;
      const metric =
        f.dwy || f.bookings === null
          ? `CPL ${cplText(f)}`
          : f.bookings === 0
            ? `no booking on ${money(spend)}, CPL ${cplText(f)}`
            : `cost per booking ${money(spend / f.bookings)}, CPL ${cplText(f)}`;
      const worst = f.dwy ? undefined : worstCampaign(f);
      const named = worst ? `, worst campaign ${worst.name} ${worst.text}` : "";
      const listed =
        f.source === "campaigns listed" ? " (campaigns listed)" : "";
      return `• ${f.client} - ${metric}${named}${listed} → ${nextStep(f, worst?.name)}`;
    });
}

/** The clients whose 7-day cost per lead is over the gate, once each. */
export function overCplGate(figures: ClientFigure[]): string[] {
  return figures
    .filter(f => f.leads > 0 && f.spend / f.leads > CPL_GATE)
    .map(f => f.client);
}
