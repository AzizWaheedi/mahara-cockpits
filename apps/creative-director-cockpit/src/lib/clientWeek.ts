/**
 * The client's last 7 days, as one figure for the whole client.
 *
 * The media sync publishes `ads7d` on the client card row (build 2 contract,
 * section 2.1): spend and leads on every Mahara campaign of the client's ad
 * accounts, stopped campaigns included and ads on the compromise list left
 * out, the confirmed bookings made on the same days, and how many of those
 * meetings showed, did not show, and came due. This file reads that object
 * and turns it into the lines the dashboard prints.
 *
 * When a publish does not carry `ads7d` yet (before the worker release, or a
 * client with no ad account), the dashboard falls back to summing the live
 * campaign rows as it did before, and says so: those rows leave stopped and
 * idle campaigns out, and they carry no no-show count, so they give no show
 * rate.
 *
 * Show rate is showed / (showed + no-show) over the meetings marked, the
 * client rule of the board and the CEO cockpit. A meeting nobody marked is
 * neither, so nothing marked reads "not marked in GoHighLevel yet", never 0%.
 * Two differences from the board are said on screen: the media sync counts
 * GoHighLevel's status only (the board also reads the client's sheet), and it
 * counts the meetings booked on these days (the board counts by meeting day).
 */

export type ClientWeekCampaign = {
  campaignName: string;
  spend: number;
  leads: number;
  bookings: number | null;
  live: boolean;
};

export type ClientWeek = {
  from: string;
  through: string;
  accounts: string[];
  spend: number;
  leads: number;
  offBoardSpend: number;
  bookings: number | null;
  bookingsWhy: string | null;
  costPerBooking: number | null;
  /**
   * Why there is no cost per booking while bookings are above 0: Mahara's
   * campaigns spent nothing on these days. Never "$0.00 a booking".
   */
  costPerBookingWhy: string | null;
  showed: number | null;
  noShows: number | null;
  due: number | null;
  /** Why showed, no-show and due are null while bookings are known. */
  marksWhy: string | null;
  campaigns: ClientWeekCampaign[];
};

/** One client's 7 days, from the media sync or from the live campaign rows. */
export type ClientPerformance = {
  /** "media sync" = the published `ads7d`; "live campaigns" = the fallback. */
  source: "media sync" | "live campaigns";
  from: string | null;
  through: string | null;
  /** False on the fallback when no ad of theirs is on our boards. */
  hasNumbers: boolean;
  spend: number;
  leads: number;
  cpl: number | null;
  offBoardSpend: number;
  /**
   * Campaigns that spent or booked in the window and are not in this week's
   * live campaign rows: stopped, or idle (under $0.50 of spend in 7 days).
   */
  stoppedCampaigns: number;
  bookings: number | null;
  bookingsWhy: string | null;
  costPerBooking: number | null;
  costPerBookingWhy: string | null;
  showed: number | null;
  noShows: number | null;
  due: number | null;
  showRate: number | null;
  showWhy: string | null;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function cents(n: number): number {
  return Math.round(n * 100) / 100;
}

function amount(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function count(raw: unknown): number | null {
  const n = amount(raw);
  return n !== null && Number.isInteger(n) ? n : null;
}

/** "act_123" and "123" are the same Meta ad account. */
export function accountKey(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/^act_/i, "");
}

/** The media sync's sentence when bookings came on days Mahara spent nothing. */
export const NO_SPEND_WHY =
  "Mahara's campaigns spent nothing on these days, so there is no cost per booking.";

/** The media sync's sentences for bookings it cannot count (BOOKINGS_WHY). */
export const DWY_WHY = "Done with you: the client books its own meetings.";
export const NO_GHL_WHY =
  "This client has no GoHighLevel connection in the cockpit, so its bookings cannot be read.";

/** The fallback rows carry no no-show count, so they never give a show rate. */
export const NO_SHOWS_YET =
  "Show rate n/a: no-shows are not in this publish yet.";

/**
 * spend / bookings to the cent, only when both are above 0: bookings on days
 * with no spend have no cost to divide, and $0.00 a booking would read as
 * inside the gate. The media sync's own figure is kept when it agrees within
 * a cent, so a half-cent tie never reads one cent apart from the worker's
 * other screens; a figure that disagrees is recomputed.
 */
function costPerBookingOf(
  spend: number,
  bookings: number | null,
  published: unknown,
): number | null {
  if (bookings === null || bookings === 0 || !(spend > 0)) return null;
  const exact = spend / bookings;
  const given = amount(published);
  return given !== null && Math.abs(given - exact) <= 0.01
    ? cents(given)
    : cents(exact);
}

/**
 * Reads the published `ads7d` object. Anything malformed reads as not
 * published (null), so the screen falls back instead of printing a wrong
 * figure or a false zero.
 */
export function readClientWeek(raw: unknown): ClientWeek | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const w = raw as Record<string, unknown>;
  if (w.source !== "media sync") return null;
  const from = typeof w.from === "string" ? w.from : "";
  const through = typeof w.through === "string" ? w.through : "";
  if (!DAY_RE.test(from) || !DAY_RE.test(through) || from > through) {
    return null;
  }
  const spend = amount(w.spend);
  const leads = count(w.leads);
  if (spend === null || leads === null) return null;
  const accounts = Array.isArray(w.accounts)
    ? [...new Set(w.accounts.map(accountKey).filter(a => /^\d+$/.test(a)))]
    : [];
  const bookings = w.bookings === null ? null : count(w.bookings);
  if (bookings === null && w.bookings !== null) return null;
  const why =
    typeof w.bookingsWhy === "string" && w.bookingsWhy.trim()
      ? w.bookingsWhy.trim()
      : null;
  // The meeting counts only mean something next to a booking count, and
  // they are counts of those bookings: more marks or more meetings due than
  // bookings means they do not describe the same meetings, so no rate.
  let showed = bookings === null ? null : count(w.showed);
  let noShows = bookings === null ? null : count(w.noShows);
  let due = bookings === null ? null : count(w.due);
  let marksWhy: string | null = null;
  if (bookings !== null) {
    if (showed === null || noShows === null) {
      marksWhy = "the show counts were not published";
    } else if (showed + noShows > bookings || (due ?? 0) > bookings) {
      marksWhy = "the show counts do not match the bookings";
    }
    if (marksWhy) {
      showed = null;
      noShows = null;
      due = null;
    }
  }
  const campaigns: ClientWeekCampaign[] = Array.isArray(w.campaigns)
    ? w.campaigns.flatMap((c: unknown) => {
        if (!c || typeof c !== "object") return [];
        const row = c as Record<string, unknown>;
        const name =
          typeof row.campaignName === "string" ? row.campaignName : "";
        if (!name) return [];
        return [
          {
            campaignName: name,
            spend: amount(row.spend) ?? 0,
            leads: count(row.leads) ?? 0,
            bookings: row.bookings === null ? null : count(row.bookings),
            live: row.live === true,
          },
        ];
      })
    : [];
  return {
    from,
    through,
    accounts,
    spend: cents(spend),
    leads,
    offBoardSpend: cents(amount(w.offBoardSpend) ?? 0),
    bookings,
    bookingsWhy:
      bookings === null
        ? (why ?? "The media sync did not read this client's bookings.")
        : null,
    costPerBooking: costPerBookingOf(spend, bookings, w.costPerBooking),
    costPerBookingWhy:
      bookings !== null && bookings > 0 && !(spend > 0)
        ? typeof w.costPerBookingWhy === "string" && w.costPerBookingWhy.trim()
          ? w.costPerBookingWhy.trim()
          : NO_SPEND_WHY
        : null,
    showed,
    noShows,
    due,
    marksWhy,
    campaigns,
  };
}

/** showed / (showed + no-show) over marked meetings; null when none is marked. */
export function showRateOf(
  showed: number | null,
  noShows: number | null,
): number | null {
  if (showed === null || noShows === null) return null;
  return showed + noShows > 0 ? showed / (showed + noShows) : null;
}

function nameKey(x: unknown): string {
  return String(x ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Picks the client's published week. A wrong client's money is never shown:
 * - a profile with campaigns takes a week only when it covers an ad account
 *   its own campaigns run on. When the client's own card (the name match)
 *   carries a week, only that week can be shown: if it sits on other
 *   accounts, the name and the account disagree about whose money it is, so
 *   the screen falls back rather than guess. A card with no week of its own,
 *   or no card by name, takes the one card whose accounts match; with none
 *   or more than one it falls back;
 * - a profile with no campaign of its own (a ClickUp task or video naming the
 *   client differently, such as "Castello industries w.l.l") takes a week
 *   only from the card with exactly its name, never through an alias.
 */
export function pickClientWeek(
  name: string,
  nameHit: any,
  board: any[],
  campaignAccounts: Iterable<unknown>,
): ClientWeek | null {
  const accounts = new Set(
    [...campaignAccounts].map(accountKey).filter(a => /^\d+$/.test(a)),
  );
  if (accounts.size === 0) {
    const key = nameKey(name);
    const exact = key ? board.find(row => nameKey(row?.name) === key) : null;
    return readClientWeek(exact?.ads7d);
  }
  const shares = (w: ClientWeek) => w.accounts.some(a => accounts.has(a));
  const own = readClientWeek(nameHit?.ads7d);
  if (own) return shares(own) ? own : null;
  const matches = board
    .map(row => readClientWeek(row?.ads7d))
    .filter((w): w is ClientWeek => w !== null && shares(w));
  return matches.length === 1 ? matches[0] : null;
}

/** The fallback rows, as the dashboard summed them before the client week. */
export type LiveRows = {
  ads: any[];
  campaigns: any[];
};

export function clientPerformance(
  week: ClientWeek | null,
  live: LiveRows,
): ClientPerformance {
  if (week) {
    const marked = showRateOf(week.showed, week.noShows);
    return {
      source: "media sync",
      from: week.from,
      through: week.through,
      hasNumbers: true,
      spend: week.spend,
      leads: week.leads,
      cpl: week.leads > 0 ? cents(week.spend / week.leads) : null,
      offBoardSpend: week.offBoardSpend,
      stoppedCampaigns: week.campaigns.filter(
        c => !c.live && (c.spend > 0 || (c.bookings ?? 0) > 0),
      ).length,
      bookings: week.bookings,
      bookingsWhy: week.bookingsWhy,
      costPerBooking: week.costPerBooking,
      costPerBookingWhy: week.costPerBookingWhy,
      showed: week.showed,
      noShows: week.noShows,
      due: week.due,
      showRate: marked,
      showWhy:
        week.bookings === null
          ? "Bookings were not read, so there is no show rate."
          : week.marksWhy
            ? `Show rate n/a: ${week.marksWhy}.`
            : marked === null
              ? "not marked in GoHighLevel yet"
              : null,
    };
  }
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;
  const isCount = (v: unknown): v is number =>
    typeof v === "number" && Number.isInteger(v) && v >= 0;
  const spend = live.ads.reduce((n, a) => n + num(a.spend), 0);
  const leads = live.ads.reduce((n, a) => n + num(a.leads), 0);
  // The client's bookings are known only when every live campaign carries a
  // count: summing the counted ones and dividing every campaign's spend by
  // them would count a missing count as 0.
  const uncounted = live.campaigns.filter(c => !isCount(c.bookings7d));
  const bookings =
    live.campaigns.length > 0 && uncounted.length === 0
      ? live.campaigns.reduce((n, c) => n + c.bookings7d, 0)
      : null;
  const campaignSpend = live.campaigns.reduce((n, c) => n + num(c.spend7d), 0);
  const showed =
    bookings !== null && live.campaigns.every(c => isCount(c.showed7d))
      ? live.campaigns.reduce((n, c) => n + c.showed7d, 0)
      : null;
  return {
    source: "live campaigns",
    from: null,
    through: null,
    hasNumbers: live.ads.length > 0,
    spend,
    leads,
    cpl: leads > 0 ? spend / leads : null,
    offBoardSpend: 0,
    stoppedCampaigns: 0,
    bookings,
    bookingsWhy:
      bookings === null ? liveBookingsWhy(live.campaigns, uncounted) : null,
    costPerBooking:
      bookings !== null && bookings > 0 && campaignSpend > 0
        ? campaignSpend / bookings
        : null,
    costPerBookingWhy:
      bookings !== null && bookings > 0 && !(campaignSpend > 0)
        ? NO_SPEND_WHY
        : null,
    showed,
    noShows: null,
    due: null,
    // The live rows carry no no-show count, so they cannot give a show rate,
    // and they cannot tell "nothing marked" from "only no-shows marked".
    showRate: null,
    showWhy:
      bookings === null
        ? "Bookings were not read, so there is no show rate."
        : NO_SHOWS_YET,
  };
}

/** Why the live campaign rows give no booking total, in the media sync's words. */
function liveBookingsWhy(campaigns: any[], uncounted: any[]): string {
  if (campaigns.length === 0) return "no campaign of theirs is live this week.";
  if (uncounted.every(c => c.serviceMode === "DWY")) return DWY_WHY;
  if (uncounted.every(c => c.hasGhl === false)) return NO_GHL_WHY;
  return uncounted.length < campaigns.length
    ? `${uncounted.length} of the ${campaigns.length} live campaigns ${uncounted.length === 1 ? "carries" : "carry"} no booking count, so the client's total is not known.`
    : "these campaigns carry no booking count.";
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "14 to 20 Oct", "28 Sep to 4 Oct", or "20 Oct" for one day. */
export function dayRange(from: string, through: string): string {
  const part = (d: string) => {
    const [, m, day] = d.split("-").map(Number);
    return { day, month: MONTHS[m - 1] ?? "" };
  };
  const a = part(from);
  const b = part(through);
  if (from === through) return `${b.day} ${b.month}`;
  return a.month === b.month
    ? `${a.day} to ${b.day} ${b.month}`
    : `${a.day} ${a.month} to ${b.day} ${b.month}`;
}

export function usd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

const SHOW_RATE_TITLE =
  "Show rate = showed / (showed + no-show), over the meetings booked on these days that GoHighLevel marks showed or no-show. A meeting nobody marked counts as neither. The Client Performance board counts show rate by meeting day and also reads the marks on the client's sheet, so its rate can differ.";

const NOT_MARKED_TITLE =
  "None of the meetings booked on these days is marked showed or no-show in GoHighLevel yet, so there is no show rate here. It is not 0%. The Client Performance board also reads the marks on the client's sheet and counts by meeting day, so it can show a rate for these days.";

const WEEK_NOTE_TITLE =
  "From the media sync. Spend and leads: every Mahara campaign on the client's ad accounts on these days, stopped or idle ones included (idle: under $0.50 of spend in the 7 days), ads on the compromise list left out, campaigns off the board left out. Bookings: every confirmed main and online calendar booking made on these days, whatever campaign it came from or none, so cost per booking divides Mahara's spend by all of them. The Client Performance board counts the whole ad account.";

const LIVE_NOTE_TITLE =
  "Summed from this week's live campaign rows: campaigns on the board that spent $0.50 or more in the last 7 days. A stopped or idle campaign's spend and bookings are not in these sums.";

export type PerformanceLine = {
  text: string;
  muted?: boolean;
  /** The small print under the figures: where they came from. */
  note?: boolean;
  title?: string;
};

/** The dashboard's "Performance" cell for one client, in plain lines. */
export function performanceView(p: ClientPerformance): {
  label: string;
  lines: PerformanceLine[];
} {
  const week = p.source === "media sync" && p.from && p.through;
  const label = week
    ? `Performance, ${dayRange(p.from as string, p.through as string)}`
    : "Performance, last 7d";
  if (!p.hasNumbers) {
    return {
      label,
      lines: [
        {
          text: "No ads on our boards",
          muted: true,
          title:
            "No campaign of theirs is on the Ads Management board and the media sync published no week for them, so their spend is not known here. It is not $0: their ad account may not be shared with Mahara.",
        },
      ],
    };
  }
  const lines: PerformanceLine[] = [];
  if (p.spend === 0 && p.leads === 0) {
    lines.push({ text: "No spend on these days" });
  } else if (p.leads > 0) {
    lines.push({
      text: `${plural(p.leads, "lead", "leads")} at ${p.cpl === null ? "n/a" : usd(p.cpl)} a lead`,
    });
  } else {
    lines.push({ text: `No leads on ${usd(p.spend)}` });
  }
  if (p.bookings === null) {
    lines.push({
      text: `Bookings n/a: ${p.bookingsWhy ?? "they were not read for this client."}`,
      muted: true,
    });
  } else if (p.bookings > 0) {
    // Bookings with no spend on these days (leads from before the window)
    // have no cost to divide, so no "$0.00 per booking".
    const cost =
      p.costPerBooking !== null
        ? ` · ${usd(p.costPerBooking)} per booking`
        : p.costPerBookingWhy
          ? ", with no spend on these days"
          : "";
    lines.push({
      text: `${p.bookings} booked${cost}`,
      muted: true,
      title: p.costPerBookingWhy ?? undefined,
    });
  } else {
    lines.push({
      text: p.spend > 0 ? `No booking yet on ${usd(p.spend)}` : "No booking",
      muted: true,
    });
  }
  if (p.bookings !== null && p.bookings > 0) {
    if (!week) {
      // The live rows carry no no-show count: whether nothing was marked or
      // only no-shows were, this screen cannot tell, so one sentence for all.
      lines.push({
        text: NO_SHOWS_YET,
        muted: true,
        title:
          "The live campaign rows carry the meetings that showed but not the no-shows, so a rate from them would be showed over every booking. The show rate comes with the media sync's week.",
      });
    } else if (p.showRate !== null && p.showed !== null && p.noShows !== null) {
      lines.push({
        text: `${Math.round(p.showRate * 100)}% show (${p.showed} of ${p.showed + p.noShows} marked), meetings booked ${dayRange(p.from as string, p.through as string)}`,
        muted: true,
        title: SHOW_RATE_TITLE,
      });
    } else if (p.showed === null || p.noShows === null) {
      lines.push({
        text: p.showWhy ?? "Show rate n/a: the show counts were not published.",
        muted: true,
      });
    } else {
      const due =
        p.due === null
          ? ""
          : p.due === 0
            ? ", no meeting has come due"
            : `, ${plural(p.due, "meeting", "meetings")} came due`;
      lines.push({
        text: `Show rate not marked in GoHighLevel yet${due}`,
        muted: true,
        title: NOT_MARKED_TITLE,
      });
    }
  }
  if (week) {
    const parts = [
      p.spend > 0
        ? `${usd(p.spend)} on Mahara's campaigns only`
        : "Mahara's campaigns only",
    ];
    if (p.stoppedCampaigns > 0) {
      parts.push(
        `${plural(p.stoppedCampaigns, "stopped or idle campaign", "stopped or idle campaigns")} included`,
      );
    }
    let text = `${parts.join(", ")}.`;
    if (p.offBoardSpend > 0) {
      text += ` ${usd(p.offBoardSpend)} on campaigns off the board left out.`;
    }
    lines.push({
      text,
      muted: true,
      note: true,
      title: WEEK_NOTE_TITLE,
    });
  } else {
    lines.push({
      text: "Live campaigns only: stopped or idle campaigns are left out until the media sync publishes the client's week.",
      muted: true,
      note: true,
      title: LIVE_NOTE_TITLE,
    });
  }
  return { label, lines };
}

/** Where the CPL chip on the client's collapsed row comes from. */
export function cplTitle(p: ClientPerformance): string {
  return p.source === "media sync" && p.from && p.through
    ? `Cost per lead, ${dayRange(p.from, p.through)}: Mahara's campaigns only, from the media sync.`
    : "Cost per lead, last 7 days: live campaigns only.";
}

/** Lines for the client context pack (the AI writing brief). */
export function weekContextLines(week: ClientWeek): string[] {
  const rate = showRateOf(week.showed, week.noShows);
  const show =
    week.bookings === null
      ? "n/a, bookings were not read"
      : week.marksWhy
        ? `n/a, ${week.marksWhy}`
        : rate !== null
          ? `${Math.round(rate * 100)}% (${week.showed} of ${(week.showed ?? 0) + (week.noShows ?? 0)} marked in GoHighLevel, of the meetings booked on these days)`
          : week.bookings === 0
            ? "no booking to mark"
            : "not marked in GoHighLevel yet";
  const lines = [
    `Client total, ${dayRange(week.from, week.through)} (media sync; Mahara's campaigns only, stopped or idle ones included):`,
    `- Spend: ${usd(week.spend)}`,
    `- Leads: ${week.leads}`,
    `- Booked calls: ${week.bookings === null ? `n/a, ${week.bookingsWhy}` : week.bookings}`,
    `- Cost per booked call: ${week.costPerBooking !== null ? usd(week.costPerBooking) : week.costPerBookingWhy ? "n/a, no spend on these days" : "n/a"}`,
    `- Show rate: ${show}`,
  ];
  if (week.offBoardSpend > 0) {
    lines.push(
      `- Left out: ${usd(week.offBoardSpend)} on campaigns off the board`,
    );
  }
  return lines;
}
