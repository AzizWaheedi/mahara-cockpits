/**
 * The rules of the exception alerts, with no I/O, so every case is a unit test
 * (plan item 4.1, approved by Muhammed 2026-10-26).
 *
 * Each active client is checked once an hour against four rules:
 *   zero_leads        spend with zero leads, only after the campaign has run 48 hours;
 *   cpb_over_line     cost per booking over the client's line on 3 days in a row, each
 *                     day's 7-day window holding enough leads and at least 3 bookings,
 *                     else "too little data";
 *   campaign_stopped  a campaign that was spending is switched on but not delivering, for
 *                     a reason other than billing (the ad billing guard owns billing);
 *   lead_sync         the lead sync watch's open gap, folded in from its own ledger.
 * Floors come from the client's own last 60 days. A problem must show on two runs in a
 * row (runs at least 45 minutes apart) before it alerts, and must be gone on two runs
 * before its episode closes. A count that could not be read is null and the rule is
 * "unknown": it never alerts, and never closes an episode, on missing data.
 */

export type Rule = "zero_leads" | "cpb_over_line" | "campaign_stopped" | "lead_sync";
export const RULES: Rule[] = ["zero_leads", "cpb_over_line", "campaign_stopped", "lead_sync"];

export const LIMITS = {
  confirmRuns: 2,
  clearRuns: 2,
  strikeGapMin: 45, // a run counts toward the confirm only this long after the last counted one
  runEveryMin: 55, // the step runs at most once in this many minutes
  perPersonPerDay: 5,
  digestHourKuwait: 16,
  zeroLeadAgeH: 48,
  zeroLeadMultiple: 2, // Aziz, 23 Oct (CPB decision 4): no-lead spend is bad at 2 x the cost per lead line
  cpbDays: 3,
  cpbWindowDays: 7,
  cpbMinBookings: 3,
  cpbMinLeads: 10,
  floorDays: 60,
  ownCplMinLeads: 10,
  recentSpendDays: 2,
  budgetsStaleMin: 180,
  maxAttempts: 3,
} as const;

/** Keep in step with cockpit_board_default_targets() (20261016133300) and src/lib/kpi.ts. */
export const OFFICIAL = { cpl: { good: 15, watch: 22.5 }, cpb: { good: 60, watch: 80 } } as const;

export type Line = { good: number; watch: number | null; source: "client" | "board" | "official" };
export type Targets = { cpl: Line; cpb: Line };

/** One client-day. null = not read (never 0); spend 0 = read, nothing spent. */
export type DayRow = { day: string; spend: number | null; metaLeads: number | null; crmAdLeads: number | null; bookings: number | null };

export type CampaignFact = {
  id: string;
  name: string;
  accountId: string;
  firstSpendDay: string | null;
  lastSpendDay: string | null;
  startAt: number | null;
  switchedOn: boolean | null;
  delivering: boolean | null;
  whyNot: string;
  /** spend by day, Mahara's ads only */
  spendByDay: Record<string, number>;
};

export type Floors = {
  from: string;
  through: string;
  spend: number;
  leads: number;
  bookings: number;
  spendDays: number;
  ownCpl: number | null;
  weekLeads: number | null;
  leadFloor: number;
  zeroLeadLine: number;
  zeroLeadBasis: string;
  firstSpendDay: string | null;
};

export type Finding = { state: "hit" | "ok" | "too_little_data" | "unknown"; reason: string; evidence: Record<string, unknown> };

const DAY = 86_400_000;
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const kuwaitDay = (ms: number) => new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10);
export const kuwaitHour = (ms: number) => new Date(ms + 3 * 3_600_000).getUTCHours();
/** Start of a Kuwait day in UTC ms (Kuwait is UTC+3 all year). */
export const kuwaitDayStart = (day: string) => Date.parse(`${day}T00:00:00Z`) - 3 * 3_600_000;
const r2 = (x: number) => Math.round(x * 100) / 100;
export const usd = (x: number | null | undefined) => (x === null || x === undefined ? "?" : `$${r2(x).toFixed(2)}`);

/** The client's own last 60 days (from..through, complete days). */
export function floors(days: DayRow[], targets: Targets, from: string, through: string): Floors {
  const inRange = days.filter(d => d.day >= from && d.day <= through);
  let spend = 0, leads = 0, bookings = 0, spendDays = 0;
  let first: string | null = null;
  for (const d of inRange) {
    if (d.spend !== null && d.spend > 0) {
      spend += d.spend;
      spendDays++;
      if (!first || d.day < first) first = d.day;
    }
    if (d.metaLeads !== null) leads += d.metaLeads;
    if (d.bookings !== null) bookings += d.bookings;
  }
  const ownCpl = leads >= LIMITS.ownCplMinLeads ? spend / leads : null;
  const weekLeads = spendDays >= 7 ? (leads / spendDays) * 7 : null;
  const leadFloor = Math.max(LIMITS.cpbMinLeads, Math.ceil(0.5 * (weekLeads ?? 0)));
  const useOwn = ownCpl !== null && ownCpl > targets.cpl.good;
  const base = useOwn ? ownCpl! : targets.cpl.good;
  return {
    from,
    through,
    spend: r2(spend),
    leads,
    bookings,
    spendDays,
    ownCpl: ownCpl === null ? null : r2(ownCpl),
    weekLeads: weekLeads === null ? null : r2(weekLeads),
    leadFloor,
    zeroLeadLine: r2(LIMITS.zeroLeadMultiple * base),
    zeroLeadBasis: useOwn
      ? `2 x its own cost per lead over 60 days (${usd(ownCpl)})`
      : `2 x the ${usd(targets.cpl.good)} cost per lead line${targets.cpl.source === "official" ? "" : ` (${targets.cpl.source})`}`,
    firstSpendDay: first,
  };
}

/**
 * Spend with zero leads. Walks back from today over the days with no lead (Meta reports 0
 * and the CRM got no ad lead) and adds the spend of the campaigns that have run 48 hours.
 */
export function zeroLeads(x: { days: DayRow[]; campaigns: CampaignFact[]; floors: Floors; today: string; nowMs: number }): Finding {
  const byDay = new Map(x.days.map(d => [d.day, d]));
  const streak: string[] = [];
  for (let day = x.today; day >= addDays(x.today, -30); day = addDays(day, -1)) {
    const d = byDay.get(day);
    if (!d || d.spend === null) {
      if (day === x.today) continue; // today not read yet
      if (!streak.length) return { state: "unknown", reason: `Meta's numbers for ${day} are not in yet.`, evidence: { day } };
      break;
    }
    if (d.spend > 0 && d.metaLeads === null)
      return { state: "unknown", reason: "Meta does not report leads for these ads (a chat or WhatsApp campaign).", evidence: { day } };
    if ((d.metaLeads ?? 0) > 0 || (d.crmAdLeads ?? 0) > 0) break;
    streak.push(day);
  }
  const recent = [x.today, addDays(x.today, -1)];
  const stillSpending = recent.some(day => (byDay.get(day)?.spend ?? 0) > 0);
  if (!streak.length || !stillSpending)
    return { state: "ok", reason: streak.length ? "No spend in the last 2 days." : "Leads are coming in.", evidence: { streakDays: streak.length } };
  const ageMs = LIMITS.zeroLeadAgeH * 3_600_000;
  const old: { name: string; spend: number }[] = [];
  let young = 0;
  for (const c of x.campaigns) {
    const spend = streak.reduce((s, day) => s + (c.spendByDay[day] ?? 0), 0);
    if (spend <= 0) continue;
    const firstMs = c.firstSpendDay ? kuwaitDayStart(c.firstSpendDay) : null;
    const start = Math.max(c.startAt ?? 0, firstMs ?? 0) || null;
    if (start !== null && x.nowMs - start >= ageMs) old.push({ name: c.name, spend: r2(spend) });
    else young += spend;
  }
  const spend = r2(old.reduce((s, c) => s + c.spend, 0));
  const from = streak[streak.length - 1];
  const evidence = { from, streakDays: streak.length, spend, line: x.floors.zeroLeadLine, basis: x.floors.zeroLeadBasis, campaigns: old, youngSpend: r2(young) };
  if (spend + young === 0) return { state: "ok", reason: "Leads are coming in.", evidence };
  if (spend >= x.floors.zeroLeadLine)
    return {
      state: "hit",
      reason: `${usd(spend)} spent with no lead since ${from} (${streak.length} day${streak.length === 1 ? "" : "s"}). The line is ${usd(x.floors.zeroLeadLine)}, ${x.floors.zeroLeadBasis}.`,
      evidence,
    };
  if (young > 0 && spend + young >= x.floors.zeroLeadLine)
    return { state: "too_little_data", reason: "No lead yet, but the campaign has run under 48 hours.", evidence };
  return { state: "ok", reason: `${usd(spend + young)} spent since the last lead, under the ${usd(x.floors.zeroLeadLine)} line.`, evidence };
}

type CpbDay = { end: string; state: "over" | "within" | "too_little_data" | "unknown"; cpb: number | null; spend: number | null; leads: number | null; bookings: number | null; why: string };

/** One 7-day window ending `end`. */
export function cpbWindow(days: DayRow[], end: string, floors: Floors, line: number): CpbDay {
  const start = addDays(end, -(LIMITS.cpbWindowDays - 1));
  const byDay = new Map(days.map(d => [d.day, d]));
  let spend = 0, leads = 0, bookings = 0;
  for (let day = start; day <= end; day = addDays(day, 1)) {
    const d = byDay.get(day);
    if (!d || d.spend === null || d.bookings === null)
      return { end, state: "unknown", cpb: null, spend: null, leads: null, bookings: null, why: `No stored ${!d || d.spend === null ? "spend" : "bookings"} for ${day}.` };
    // Chat campaigns have no Meta lead count; the CRM's ad leads stand in (they leave chats
    // out, so a chat client reads "too little data", never a false alert).
    const dayLeads = d.metaLeads ?? d.crmAdLeads;
    if (d.spend > 0 && dayLeads === null)
      return { end, state: "unknown", cpb: null, spend: null, leads: null, bookings: null, why: `No lead count for ${day}.` };
    spend += d.spend;
    leads += dayLeads ?? 0;
    bookings += d.bookings;
  }
  const base = { end, spend: r2(spend), leads, bookings };
  if (!floors.firstSpendDay || floors.firstSpendDay > start)
    return { ...base, state: "too_little_data", cpb: null, why: `Ads have run fewer than ${LIMITS.cpbWindowDays} days.` };
  if (bookings < LIMITS.cpbMinBookings)
    return { ...base, state: "too_little_data", cpb: null, why: `${bookings} booking${bookings === 1 ? "" : "s"} in the 7 days (needs ${LIMITS.cpbMinBookings}).` };
  if (leads < floors.leadFloor) return { ...base, state: "too_little_data", cpb: null, why: `${leads} leads in the 7 days (needs ${floors.leadFloor}).` };
  const cpb = r2(spend / bookings);
  return { ...base, cpb, state: cpb > line ? "over" : "within", why: "" };
}

/** Cost per booking over the client's line on each of the last 3 complete days. */
export function cpbOverLine(x: { days: DayRow[]; floors: Floors; targets: Targets; serviceMode: string | null; today: string }): Finding {
  if (String(x.serviceMode ?? "").toUpperCase() === "DWY") return { state: "ok", reason: "Done with you: the client books its own meetings.", evidence: {} };
  const line = x.targets.cpb.watch ?? x.targets.cpb.good;
  const windows = Array.from({ length: LIMITS.cpbDays }, (_, i) => cpbWindow(x.days, addDays(x.today, -(i + 1)), x.floors, line));
  const evidence = { line, lineSource: x.targets.cpb.source, windows, leadFloor: x.floors.leadFloor };
  const latest = windows[0];
  if (windows.every(w => w.state === "over"))
    return {
      state: "hit",
      reason: `Cost per booking ${usd(latest.cpb)} over the last 7 days (${usd(latest.spend)} for ${latest.bookings} bookings), over the ${usd(line)} line for ${LIMITS.cpbDays} days in a row.`,
      evidence,
    };
  const within = windows.find(w => w.state === "within");
  if (within) return { state: "ok", reason: `Cost per booking ${usd(within.cpb)} over the 7 days to ${within.end}, within the ${usd(line)} line.`, evidence };
  const unknown = windows.find(w => w.state === "unknown");
  if (unknown) return { state: "unknown", reason: unknown.why, evidence };
  const over = windows.filter(w => w.state === "over").length;
  const thin = windows.find(w => w.state === "too_little_data")!;
  return { state: "too_little_data", reason: `Too little data: ${thin.why}${over ? ` Over the line on ${over} of ${LIMITS.cpbDays} days.` : ""}`, evidence };
}

const BILLING_WHY = /payment|unsettled|billing|grace|settle/i;
const BILLING_STATUS = new Set([3, 8, 9]);
const BILLING_SIGNAL = new Set(["payment_grace", "unsettled"]);

/** A campaign that spent in the last 2 days, now switched on but not delivering, not for billing. */
export function campaignStopped(x: {
  campaigns: CampaignFact[];
  accounts: { id: string; status: number | null; billingSignal: string | null }[];
  budgetsFetchedAt: number | null;
  today: string;
  nowMs: number;
}): Finding {
  const since = addDays(x.today, -LIMITS.recentSpendDays);
  const recent = x.campaigns.filter(c => c.lastSpendDay !== null && c.lastSpendDay >= since);
  if (!recent.length) return { state: "ok", reason: "No Mahara campaign spent in the last 2 days.", evidence: {} };
  if (x.budgetsFetchedAt === null || x.nowMs - x.budgetsFetchedAt > LIMITS.budgetsStaleMin * 60_000)
    return { state: "unknown", reason: "Meta's campaign status is older than 3 hours.", evidence: { budgetsFetchedAt: x.budgetsFetchedAt } };
  const billingAccount = new Set(x.accounts.filter(a => (a.status !== null && BILLING_STATUS.has(a.status)) || (a.billingSignal !== null && BILLING_SIGNAL.has(a.billingSignal))).map(a => a.id));
  const stopped = recent.filter(c => c.delivering === false && (c.switchedOn === true || c.whyNot === "Ended"));
  const billing = stopped.filter(c => billingAccount.has(c.accountId) || BILLING_WHY.test(c.whyNot));
  const other = stopped.filter(c => !billing.includes(c));
  const evidence = { stopped: other.map(c => ({ id: c.id, name: c.name, whyNot: c.whyNot || "Not delivering", lastSpendDay: c.lastSpendDay })), billing: billing.map(c => c.name) };
  if (other.length)
    return {
      state: "hit",
      reason: other.map(c => `${c.name} is ${c.whyNot === "Ended" ? "past its end date" : "switched on but not delivering"}: ${c.whyNot || "no reason given"}.`).join(" "),
      evidence,
    };
  if (billing.length) return { state: "ok", reason: "Stopped for billing. The ad billing guard handles it.", evidence };
  return { state: "ok", reason: "Every campaign that spent in the last 2 days is delivering or was paused.", evidence };
}

/** The lead sync watch's verdict, read from cockpit_lead_sync_status. It already confirmed on 2 runs. */
export function leadSync(
  row: { state: string; reason: string; episode_id: string | null; meta_24h: number | null; crm_24h: number | null } | undefined,
  spendingRecently: boolean,
): Finding {
  if (!row)
    return spendingRecently
      ? { state: "unknown", reason: "The lead sync watch has no row for this client.", evidence: {} }
      : { state: "ok", reason: "No live campaign for the lead sync watch to check.", evidence: {} };
  if ((row.state === "gap" || row.state === "stalled") && row.episode_id)
    return { state: "hit", reason: row.reason || "Facebook leads are not reaching the CRM.", evidence: { episode: row.episode_id } };
  if (row.state === "unknown") return { state: "unknown", reason: "The lead sync watch could not check this client.", evidence: {} };
  // A fixed sentence: the watch's own counts change every 15 minutes and would rewrite the row.
  return { state: "ok", reason: "Facebook leads reach the CRM (lead sync watch).", evidence: {} };
}

export type Prior = {
  state: string;
  strikes: number;
  clears: number;
  episodeId: string | null;
  firstSeenAt: string | null;
  openedAt: string | null;
  lastStrikeAt: string | null;
};
export const NO_PRIOR: Prior = { state: "ok", strikes: 0, clears: 0, episodeId: null, firstSeenAt: null, openedAt: null, lastStrikeAt: null };

export type Next = Prior & { state: "ok" | "watch" | "open" | "too_little_data" | "unknown"; opened: boolean; closed: boolean };

/** Two-run confirm, two-run clear; missing data keeps whatever was there. */
export function decide(rule: Rule, clientKey: string, prior: Prior, f: Finding, nowMs: number, episodeOverride?: string | null): Next {
  const nowIso = new Date(nowMs).toISOString();
  if (f.state === "unknown")
    return { ...prior, state: prior.state === "open" || prior.state === "watch" ? (prior.state as "open" | "watch") : "unknown", opened: false, closed: false };
  if (f.state === "hit") {
    const counted = !prior.lastStrikeAt || nowMs - Date.parse(prior.lastStrikeAt) >= LIMITS.strikeGapMin * 60_000;
    const strikes = prior.state === "open" ? Math.max(prior.strikes, LIMITS.confirmRuns) : counted ? prior.strikes + 1 : Math.max(prior.strikes, 1);
    const firstSeenAt = prior.firstSeenAt ?? nowIso;
    const episodeId = episodeOverride ?? prior.episodeId ?? `${rule}:${clientKey}:${firstSeenAt}`;
    const confirmed = rule === "lead_sync" || strikes >= LIMITS.confirmRuns;
    return {
      state: confirmed ? "open" : "watch",
      strikes,
      clears: 0,
      episodeId,
      firstSeenAt,
      openedAt: confirmed ? (prior.openedAt ?? nowIso) : null,
      lastStrikeAt: counted ? nowIso : prior.lastStrikeAt,
      opened: confirmed && prior.state !== "open",
      closed: false,
    };
  }
  if (prior.state === "open") {
    const counted = !prior.lastStrikeAt || nowMs - Date.parse(prior.lastStrikeAt) >= LIMITS.strikeGapMin * 60_000;
    const clears = counted ? prior.clears + 1 : prior.clears;
    if (rule !== "lead_sync" && clears < LIMITS.clearRuns)
      return { ...prior, state: "open", clears, lastStrikeAt: counted ? nowIso : prior.lastStrikeAt, opened: false, closed: false };
    return { ...NO_PRIOR, state: f.state, opened: false, closed: true };
  }
  return { ...NO_PRIOR, state: f.state, opened: false, closed: false };
}

export const RULE_LABEL: Record<Rule, string> = {
  zero_leads: "Spend with no leads",
  cpb_over_line: "Cost per booking over the line",
  campaign_stopped: "Campaign stopped",
  lead_sync: "Leads not reaching the CRM",
};

const NEXT_STEP: Record<Rule, string> = {
  zero_leads: "Check the lead form, the pixel and the page, and submit a test lead.",
  cpb_over_line: "Check which ad books worst and how fast the leads are called.",
  campaign_stopped: "Open the campaign in Ads Manager and fix what Meta flags.",
  lead_sync: "Check the Facebook connection in the client's CRM.",
};

/** The DM. Plain words, one link, a reference tag for the ledger. */
export function alertText(x: { rule: Rule; client: string; reason: string; link: string; ref: string }): string {
  return [`*${x.client}*: ${RULE_LABEL[x.rule].toLowerCase()}.`, x.reason, NEXT_STEP[x.rule], `<${x.link}|Open ${x.client} in the cockpit>`, `_ref ${x.ref}_`].join("\n");
}

export function digestText(x: { day: string; items: { rule: Rule; client: string; reason: string; link: string }[]; unowned: boolean; ref: string }): string {
  const head = x.unowned
    ? `*Exception alerts with no owner, ${x.day}* (${x.items.length}). Nobody in the cockpit owns these clients for this rule.`
    : `*Your other exception alerts, ${x.day}* (${x.items.length}). You had ${LIMITS.perPersonPerDay} alerts today already, so these wait here.`;
  return [head, ...x.items.map(i => `- <${i.link}|${i.client}>: ${RULE_LABEL[i.rule].toLowerCase()}. ${i.reason}`), `_ref ${x.ref}_`].join("\n");
}
