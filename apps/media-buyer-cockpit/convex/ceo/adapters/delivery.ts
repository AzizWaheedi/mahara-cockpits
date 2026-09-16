import { internal } from "../../_generated/api";
import { OFF_STATUSES } from "../../board";
import { CPB_GATE, CPL_GATE } from "../../constants";
import type { DeliveryPayload, DeliveryWindow, Note } from "../payloads";
import { addDays, kuwaitDay, monthStart } from "../time";
import type { Adapter, DailyPoint, SourceStamp } from "../types";

type Any = any;

// The gates come from convex/constants.ts, the one place the whole cockpit
// reads them, so the delivery colours, the client risk points and the KPI
// screens can never judge the same cost against two different numbers.
/** Days from signup to launch (DEL-16 target); an onboarding client past it is stuck. */
const LAUNCH_DAYS = 7;
/** The sync runs every 10 minutes by day and hourly overnight; 3 hours behind is stale. */
const STALE_MS = 3 * 3600_000;

type Status = DeliveryPayload["clients"][number]["status"];
const STATUS_ORDER: Record<Status, number> = {
  bad: 0,
  watch: 1,
  good: 2,
  "no-data": 3,
};

const usd = (x: number) => Math.round(x * 100) / 100;

/** Whole dollars with thousands commas, without relying on Intl. */
const dollars = (x: number) =>
  `$${String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** Same folding the sync and csmSync use to match names across systems. */
const norm = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

/** Launch task and client card names differ ("ARDON", "Arch Home - ..."): exact or a 5+ letter prefix. */
function sameClient(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return (
    Math.min(x.length, y.length) >= 5 && (x.startsWith(y) || y.startsWith(x))
  );
}

/** The launch watch's first sentence, without links or dashes, for a one-line blocker. */
function shortIssue(text: string): string {
  const first = text.split(/\s+[—–]\s+|(?<=\.)\s/)[0] ?? "";
  const s = first
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (/[.!?]$/.test(s) ? s : `${s}.`).slice(0, 200);
}

function statusOf(
  spend: number,
  leads: number,
  cpl: number | null,
  cpb: number | null,
  tracked: boolean,
): Status {
  if (spend <= 0) return "no-data";
  if (leads === 0 || (cpl !== null && cpl > CPL_GATE * 1.5)) return "bad";
  // A client whose bookings are not read (DWY, or no GHL connection) is
  // judged on cost per lead alone, as the sync judges DWY campaigns. One
  // whose bookings are read also needs bookings within the booking gate, as
  // the sync holds a campaign over it. Recent bookings read low, so a cost
  // per booking over the gate is a watch, never bad on its own.
  if (
    cpl !== null &&
    cpl <= CPL_GATE &&
    (!tracked || (cpb !== null && cpb <= CPB_GATE))
  )
    return "good";
  return "watch";
}

/**
 * Client delivery: Meta spend and leads from the on-board campaign grain, GHL
 * bookings, campaign verdicts and board status, off-board spend, blocked ad
 * accounts and launches. All from the media buyer Convex tables the sync
 * rebuilds, read in one bounded internal query.
 */
export const delivery: Adapter = {
  key: "delivery",
  label: "Client delivery",
  compute: async ctx => {
    const data: Any = await ctx.runQuery(internal.ceo.data.delivery.load, {});
    const now = Date.now();
    const today: string = data?.today ?? kuwaitDay(now);
    const yesterday = addDays(today, -1);
    const campaigns: Any[] = data?.campaigns ?? [];
    // Nothing on the board usually means the sync is mid-rewrite; keep the
    // last good payload instead of showing an empty section.
    if (campaigns.length === 0)
      throw new Error(
        "No on-board campaigns in the media buyer tables (the sync may be rewriting them)",
      );

    const notes: Note[] = [];
    const warn = (text: string) => notes.push({ level: "warn", text });
    const info = (text: string) => notes.push({ level: "info", text });
    info(
      `Spend and leads are Meta only, for campaigns on the Ads Management board, in USD after a fixed exchange table. A day is the ad account's reporting day. Gates are Aziz's (2026-09-16): cost per lead $${CPL_GATE}, cost per booking $${CPB_GATE}. A client is good within both gates, bad with no leads or a cost per lead over $${(CPL_GATE * 1.5).toFixed(2)}, and on watch otherwise.`,
    );

    const grain: {
      campaignName: string;
      date: string;
      spend: number;
      leads: number;
    }[] = data.daily ?? [];
    const booked: {
      campaignName: string;
      date: string;
      count: number;
      copies: number;
    }[] = data.bookings ?? [];
    const tracked = new Set<string>(
      campaigns.filter(c => c.bookingsTracked).map(c => c.campaignName),
    );

    // campaigns.spend7d and bookings7d cover the 7 days up to the day the sync
    // ran, including that day, so compare the rows over the same days: after
    // Kuwait midnight today's window has already moved on.
    const syncAt = Math.max(0, ...campaigns.map(c => Number(c.syncedAt ?? 0)));
    const syncWeekFrom = addDays(kuwaitDay(syncAt || now), -7);

    // The daily grain and the sync's own 7-day totals come from the same pull.
    // The sync clears the grain before it writes it back in chunks, so rows
    // far short of the totals mean a rewrite in flight or a failed write:
    // keep the last good payload rather than show missing spend as zero.
    const syncTotal = campaigns.reduce((s, c) => s + c.spend7d, 0);
    let grainTotal = 0;
    for (const d of grain) if (d.date >= syncWeekFrom) grainTotal += d.spend;
    if (syncTotal >= 50 && grainTotal < syncTotal * 0.5)
      throw new Error(
        `Daily ad rows add up to ${dollars(grainTotal)} for the sync's last 7 days against ${dollars(syncTotal)} in the campaign totals (the sync may be rewriting them)`,
      );

    /** Per campaign spend, leads and bookings over an inclusive day range. */
    const byCampaign = (from: string, to: string) => {
      const out = new Map<
        string,
        { spend: number; leads: number; bookings: number }
      >();
      const row = (name: string) => {
        const r = out.get(name) ?? { spend: 0, leads: 0, bookings: 0 };
        out.set(name, r);
        return r;
      };
      for (const d of grain)
        if (d.date >= from && d.date <= to) {
          const r = row(d.campaignName);
          r.spend += d.spend;
          r.leads += d.leads;
        }
      for (const b of booked)
        if (b.date >= from && b.date <= to)
          row(b.campaignName).bookings += b.count;
      return out;
    };

    const windowOf = (from: string, to: string): DeliveryWindow => {
      let spend = 0;
      let leads = 0;
      let bookings = 0;
      let trackedSpend = 0;
      for (const [name, r] of byCampaign(from, to)) {
        spend += r.spend;
        leads += r.leads;
        bookings += r.bookings;
        if (tracked.has(name)) trackedSpend += r.spend;
      }
      return {
        spend: usd(spend),
        leads,
        cpl: leads > 0 ? usd(spend / leads) : null,
        bookings,
        // Bookings exist only for campaigns whose GHL is read, so only their
        // spend is divided.
        cpb:
          bookings > 0 && trackedSpend > 0
            ? usd(trackedSpend / bookings)
            : null,
      };
    };

    // Full Kuwait days ending yesterday; the month to date includes today.
    const last7From = addDays(today, -7);
    const prevFrom = addDays(today, -14);
    const prevTo = addDays(today, -8);
    const seriesFrom = addDays(today, -30);

    const dailySeries: DeliveryPayload["daily"] = [];
    {
      const byDay = new Map<
        string,
        { spend: number; leads: number; bookings: number }
      >();
      for (const d of grain) {
        const r = byDay.get(d.date) ?? { spend: 0, leads: 0, bookings: 0 };
        r.spend += d.spend;
        r.leads += d.leads;
        byDay.set(d.date, r);
      }
      for (const b of booked) {
        const r = byDay.get(b.date) ?? { spend: 0, leads: 0, bookings: 0 };
        r.bookings += b.count;
        byDay.set(b.date, r);
      }
      for (let date = seriesFrom; date <= yesterday; date = addDays(date, 1)) {
        const r = byDay.get(date);
        dailySeries.push({
          date,
          spend: usd(r?.spend ?? 0),
          leads: r?.leads ?? 0,
          bookings: r?.bookings ?? 0,
        });
      }
    }

    // --- Client cards: ClickUp task id by client name --------------------
    const cards: Any[] = data.clients ?? [];
    if (data.clientsError)
      warn(
        "Client cards could not be read, so client rows carry no ClickUp id and launches are empty.",
      );
    const cardByName = new Map<string, Any>();
    for (const c of cards) cardByName.set(norm(c.name), c);
    const cardOf = (c: Any) =>
      cardByName.get(norm(c.clientName ?? c.accountName));

    // --- Campaigns: running on Meta, verdicts, board off, off board -------
    const offOnBoard = new Set(OFF_STATUSES.map(s => s.toLowerCase()));
    const activeOnMeta = new Map<string, boolean>(
      ((data.tree ?? []) as Any[]).map(t => [t.campaignName, t.active]),
    );
    if (data.treeError)
      warn(
        "The Meta ad tree could not be read, so running means spend on the last reported day.",
      );
    // Same rule as Ads management: Meta's ad and ad set statuses when the
    // tree has the campaign, else spend on the last day or the day before.
    const runningOnMeta = (c: Any): boolean =>
      activeOnMeta.has(c.campaignName)
        ? Boolean(activeOnMeta.get(c.campaignName))
        : c.spendToday > 0 && String(c.dataThrough ?? "") >= yesterday;
    const running = campaigns.filter(runningOnMeta);
    const verdicts: Record<string, number> = {};
    for (const c of running)
      verdicts[c.verdict] = (verdicts[c.verdict] ?? 0) + 1;
    const boardOffButRunning = running.filter(c =>
      offOnBoard.has(String(c.boardAdStatus ?? "").toLowerCase()),
    ).length;

    const offBoard: Any[] = (data.offBoard ?? []).filter(
      (o: Any) => o.spend7d > 0,
    );
    if (data.offBoardError)
      warn("Campaigns spending with no board card could not be read.");
    else if (offBoard.length > 0) {
      const spend = offBoard.reduce((s, o) => s + o.spend7d, 0);
      warn(
        `${dollars(spend)} spent in the last 7 days on ${plural(offBoard.length, "campaign")} with no Ads Management card is not in these numbers.`,
      );
    }

    // --- Clients with spend in the last 7 days ----------------------------
    const last7ByCampaign = byCampaign(last7From, yesterday);
    const groups = new Map<
      string,
      {
        client: string;
        clickupTaskId: string | null;
        spend: number;
        leads: number;
        bookings: number;
        trackedSpend: number;
        tracked: boolean;
        campaigns: number;
      }
    >();
    for (const c of campaigns) {
      const r = last7ByCampaign.get(c.campaignName);
      if (!r || r.spend <= 0) continue;
      const card = cardOf(c);
      const key = card
        ? `task:${card.taskId}`
        : `name:${norm(c.clientName ?? c.accountName)}`;
      const g = groups.get(key) ?? {
        client: card?.name ?? c.clientName ?? c.accountName,
        clickupTaskId: card?.taskId ?? null,
        spend: 0,
        leads: 0,
        bookings: 0,
        trackedSpend: 0,
        tracked: false,
        campaigns: 0,
      };
      g.spend += r.spend;
      g.leads += r.leads;
      g.bookings += r.bookings;
      g.campaigns += 1;
      if (tracked.has(c.campaignName)) {
        g.tracked = true;
        g.trackedSpend += r.spend;
      }
      groups.set(key, g);
    }
    const clients: DeliveryPayload["clients"] = [...groups.values()]
      .map(g => {
        const cpl = g.leads > 0 ? usd(g.spend / g.leads) : null;
        const cpb =
          g.bookings > 0 && g.trackedSpend > 0
            ? usd(g.trackedSpend / g.bookings)
            : null;
        return {
          client: g.client,
          clickupTaskId: g.clickupTaskId,
          spend7d: usd(g.spend),
          leads7d: g.leads,
          cpl7d: cpl,
          bookings7d: g.bookings,
          cpb7d: cpb,
          campaigns: g.campaigns,
          status: statusOf(g.spend, g.leads, cpl, cpb, g.tracked),
        };
      })
      .sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
          b.spend7d - a.spend7d,
      );

    // --- Blocked ad accounts, one row per account --------------------------
    const accountIssues: DeliveryPayload["accountIssues"] = [];
    {
      const seen = new Set<string>();
      for (const c of campaigns) {
        if (!c.accountIssue) continue;
        const key = c.metaAccountId ?? norm(c.accountName);
        if (seen.has(key)) continue;
        seen.add(key);
        accountIssues.push({
          client: cardOf(c)?.name ?? c.clientName ?? c.accountName,
          issue: String(c.accountIssue),
        });
      }
    }

    // --- Launches ------------------------------------------------------------
    // In flight: client cards still in an onboarding stage. Stuck: past the
    // launch target, with what blocks them from the launch watch, else the
    // state of their open launch task.
    const tasks: Any[] = data.launches?.tasks ?? [];
    const watch: Any[] = data.launches?.watch ?? [];
    if (data.launchError)
      warn(
        "Launch tasks and the launch watch could not be read, so blockers are missing.",
      );
    const onboarding = cards.filter(c => c.onboarding);
    const stuck: DeliveryPayload["launches"]["stuck"] = [];
    let ageUnknown = 0;
    for (const c of onboarding) {
      if (c.signupDays === null || c.signupDays === undefined) {
        ageUnknown += 1;
        continue;
      }
      if (c.signupDays <= LAUNCH_DAYS) continue;
      const issue = watch.find(w => sameClient(w.client, c.name))?.issues?.[0];
      const task = tasks.find(t => sameClient(t.client, c.name));
      const blocker = issue
        ? shortIssue(String(issue))
        : data.launchError
          ? null
          : !task
            ? "No open launch task found on the ads boards."
            : task.total > 0
              ? `Launch checklist ${task.done} of ${task.total} done.`
              : null;
      stuck.push({ client: c.name, days: c.signupDays, blocker });
    }
    stuck.sort((a, b) => b.days - a.days);
    if (!data.clientsError)
      info(
        `Launch age is days since the client card was created; a launch counts as stuck after ${LAUNCH_DAYS} days.${ageUnknown ? ` ${plural(ageUnknown, "onboarding client")} ${ageUnknown === 1 ? "has" : "have"} no creation date.` : ""}`,
      );
    const strayTasks = tasks.filter(
      t => !onboarding.some(c => sameClient(t.client, c.name)),
    );
    if (strayTasks.length && !data.clientsError)
      info(
        `Open launch tasks on clients whose card is not in an onboarding stage: ${strayTasks.map(t => t.client).join(", ")}.`,
      );

    // --- Trust notes ----------------------------------------------------------
    const earliestNeeded = [seriesFrom, prevFrom, monthStart(today)].sort()[0];
    if (!data.firstDate) warn("No daily ad rows in the last 40 days.");
    else if (data.firstDate > earliestNeeded)
      warn(
        `Daily ad history starts ${data.firstDate}, so earlier days read 0.`,
      );
    if (data.lastDate && data.lastDate < yesterday)
      info(`The newest daily ad data is for ${data.lastDate}.`);
    info(
      "A campaign taken off the board loses its last 30 days of ad rows at the next sync, so past totals can drop.",
    );

    // A smaller gap than the one that throws above: some grain rows were lost.
    if (Math.abs(syncTotal - grainTotal) > Math.max(25, syncTotal * 0.1))
      warn(
        `The daily ad rows add up to ${dollars(grainTotal)} for the last 7 days, but the campaign totals say ${dollars(syncTotal)}; some daily rows are missing.`,
      );
    if (data.grainCapped)
      warn(
        "A campaign has more daily ad or booking rows than one read takes, so some days are cut short.",
      );

    const untracked = [...groups.values()]
      .filter(g => !g.tracked)
      .map(g => g.client);
    warn(
      `Bookings come from GHL for Done For You clients with a working GHL connection (${clients.length - untracked.length} of ${clients.length} clients with spend). The sync reads appointments up to now only, so a booking made for a later date is counted once that day comes and the latest days read low.`,
    );
    if (untracked.length)
      info(
        `${plural(untracked.length, "client")} without booking data (${untracked.join(", ")}) ${untracked.length === 1 ? "is" : "are"} judged on cost per lead alone, and cost per booking leaves out their spend.`,
      );
    const copies = booked
      .filter(b => b.date >= earliestNeeded)
      .reduce((s, b) => s + b.copies, 0);
    if (copies > 0)
      info(
        `${plural(copies, "repeated booking row")} left over from earlier syncs ${copies === 1 ? "was" : "were"} not counted.`,
      );
    // campaigns.bookings7d is the client's whole GHL count; the booking rows
    // keep only bookings tied to the client's board campaigns. A booking
    // bought by an off-board ad is in the first and not the second.
    {
      const perClient = new Map<
        string,
        { client: string; ghl: number; rows: number }
      >();
      const rowsByCampaign = byCampaign(syncWeekFrom, today);
      for (const c of campaigns) {
        if (!c.bookingsTracked) continue;
        const card = cardOf(c);
        const key = card?.taskId ?? norm(c.clientName ?? c.accountName);
        const p = perClient.get(key) ?? {
          client: card?.name ?? c.clientName ?? c.accountName,
          ghl: 0,
          rows: 0,
        };
        p.ghl = Math.max(p.ghl, Number(c.clientBookings7d ?? 0));
        p.rows += rowsByCampaign.get(c.campaignName)?.bookings ?? 0;
        perClient.set(key, p);
      }
      const short = [...perClient.values()].filter(p => p.ghl > p.rows);
      if (short.length) {
        const missing = short.reduce((s, p) => s + p.ghl - p.rows, 0);
        warn(
          `GHL shows ${plural(missing, "more booking")} in the last 7 days than the board campaigns carry (${short.map(p => p.client).join(", ")}): bookings bought by ads outside the board campaigns are not counted.`,
        );
      }
    }

    // --- Sources ----------------------------------------------------------------
    const health = data.health ?? {};
    const metaFresh = syncAt > 0 && now - syncAt <= STALE_MS;
    if (!metaFresh)
      warn(
        `The media buyer sync last wrote campaign numbers ${Math.round((now - syncAt) / 3600_000)} hours ago.`,
      );
    const clickupAt = Math.max(
      0,
      ...cards.map(c => Number(c.syncedAt ?? 0)),
      ...tasks.map(t => Number(t.syncedAt ?? 0)),
    );
    const failing = (source: string) =>
      health[source]?.ok === false
        ? `Failing ${plural(Number(health[source].streak ?? 1), "time")} in a row`
        : undefined;
    const sources: SourceStamp[] = [
      {
        name: "Meta ads (media buyer sync)",
        freshestAt: syncAt || undefined,
        ok: metaFresh && health.meta?.ok !== false,
        note: failing("meta") ?? (metaFresh ? undefined : "Sync is stale"),
      },
      {
        name: "GHL bookings",
        freshestAt: data.bookingsSyncedAt ?? undefined,
        ok: health.ghl?.ok !== false,
        note: failing("ghl"),
      },
      {
        name: "ClickUp board, launch tasks and client cards",
        freshestAt: clickupAt || undefined,
        ok:
          health.clickup?.ok !== false &&
          !data.clientsError &&
          !data.launchError,
        note:
          failing("clickup") ??
          (data.clientsError || data.launchError
            ? "Client cards or launch tasks could not be read"
            : undefined),
      },
    ];

    // Warnings first; the sort is stable, so each level keeps its order.
    notes.sort(
      (a, b) => Number(b.level === "warn") - Number(a.level === "warn"),
    );

    const payload = {
      yesterday: windowOf(yesterday, yesterday),
      last7: windowOf(last7From, yesterday),
      prevLast7: windowOf(prevFrom, prevTo),
      mtd: windowOf(monthStart(today), today),
      daily: dailySeries,
      gates: { cpl: CPL_GATE, cpb: CPB_GATE },
      campaigns: {
        running: running.length,
        boardOffButRunning,
        spendingNotOnBoard: offBoard.length,
        verdicts,
      },
      clients,
      launches: { inFlight: onboarding.length, stuck },
      accountIssues,
      notes,
    } satisfies DeliveryPayload;

    // Today's counts the tables overwrite every sync, so they gain a history.
    const point = (metric: string, value: number): DailyPoint => ({
      date: today,
      metric: `delivery.${metric}`,
      scope: "company",
      value,
    });
    // A count built on a failed read is skipped, never saved as history.
    const daily: DailyPoint[] = [point("accountIssues", accountIssues.length)];
    if (!data.treeError)
      daily.push(
        point("campaigns.running", running.length),
        point("campaigns.kill", verdicts.kill ?? 0),
        point("campaigns.boardOffButRunning", boardOffButRunning),
      );
    if (!data.offBoardError)
      daily.push(point("campaigns.spendingNotOnBoard", offBoard.length));
    if (!data.clientsError) daily.push(point("launches.stuck", stuck.length));

    return { payload, daily, sources };
  },
};
