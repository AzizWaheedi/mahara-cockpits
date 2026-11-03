import { CPL_GATE } from "./kpi";
export type LaunchRow = {
  id: string;
  clickup_id?: string;
  campaign_name: string;
  account_id: string;
  state: "built" | "switched_on" | "reconcile" | "discarded";
  created_at: string;
  switched_on_at?: string;
  meta_campaign_id?: string;
  inAds?: boolean;
  hasImpressions?: boolean;
  budget_usd?: number;
  today?: {
    impressions: number | null;
    spend: number | null;
    leads: number | null;
  };
  card_task_id?: string;
};
export type LaunchAccount = {
  id: string;
  name: string | null;
  status: number | null;
  currency: string | null;
  readAt?: string;
  lastRan: string | null;
  hasHistory: boolean;
};
export type ClientNotice = {
  id: string;
  version: string;
  kind: string;
  title: string;
  body: string;
  href: string;
  clientId?: string;
  clientName?: string;
  read?: boolean;
  priority: number;
  task?: any;
};
export type ClientNotices = {
  asOf: string;
  sourceAt?: string;
  tasksReady: boolean;
  notices: ClientNotice[];
};
export type LaunchClient = {
  serviceHold?: { mode: string; state: string; reason: string };
  mediaTasks?: ClientNotice[];
  tasksReady?: boolean;
  actionHistory?: {
    id: string;
    operation: string;
    state: string;
    at: string;
    actor: string;
    campaign?: string;
    did?: string;
  }[];
  id: string;
  locationId: string;
  name: string;
  status: string;
  registryStatus?: string;
  stage: string | null;
  serviceMode: string;
  lane: Lane | "search";
  ghosted: boolean;
  readOnly: boolean;
  accounts: LaunchAccount[];
  brief: any;
  caller: boolean | null;
  cards: any[];
  tasks: any[];
  launches: LaunchRow[];
  waiting: boolean;
  inAds: boolean;
  history: any[];
  handover?: any;
  /** The kickoff's daily budget (20261103e), one client only. Null with no budget answered. */
  kickoffBudget?: KickoffBudget | null;
  /**
   * The Ads card's Daily Ad Spend as cockpit-sync keeps it (cockpit_campaigns,
   * 20261103e), one client only: the boardCards mirror omits the field.
   */
  adsCards?: { taskId: string | null; dailyAdSpend: number }[];
  /** The agreed-budget chain as the server reads it (20261103e): the desk's default and 2x cap follow it. */
  agreedBudget?: AgreedBudget;
  links?: any;
  people?: any[];
  starterPack?: string;
  updatedAt?: string;
};
/**
 * The kickoff's daily budget: the amount and currency the CSM sent, in
 * dollars at the cockpit's fixed rate (null with no rate, never 0). `said` is
 * the typed text, kept only for an old Typeform answer read as dollars.
 */
export type KickoffBudget = {
  amount: number | null;
  currency: string | null;
  usd: number | null;
  fromText: boolean;
  said: string | null;
  at: string | null;
};
export type BudgetSourceKey =
  | "adsCard"
  | "blueprint"
  | "blueprintDraft"
  | "kickoff"
  | "sale";
export type BudgetSource = {
  key: BudgetSourceKey;
  /** "Ads card", "Blueprint part 1", "Kickoff, 150 SAR", "Sale (card Daily Budget)". */
  label: string;
  /** The same, mid-sentence: "the Ads card", "kickoff, 150 SAR", "the sale". */
  from: string;
  usd: number | null;
  /** The source the default came from. */
  used: boolean;
  /** Why a source found is not the default. */
  note: string | null;
};
export type AgreedBudget = {
  usd: number | null;
  key: BudgetSourceKey | null;
  source: string | null;
  from: string | null;
  sources: BudgetSource[];
  notes: string[];
};
export type Lane = "onboarding" | "ready" | "nothing" | "waiting" | "ads";
export type LaunchPipeline = {
  notices?: ClientNotices;
  asOf: string;
  sources: any;
  clients: LaunchClient[];
  lanes: Record<Lane, number>;
};
export const LANES: { id: Lane; name: string; rule: string; empty: string }[] =
  [
    {
      id: "onboarding",
      name: "In onboarding",
      rule: "Gathering the brief, access and caller",
      empty:
        "No client is in onboarding. A client appears here when its card moves to Brand Blueprint booked.",
    },
    {
      id: "ready",
      name: "Ready to launch",
      rule: "Blueprint part 1 sent or a launch task open",
      empty:
        "No launch brief is waiting. A client lands here when the creative director sends Blueprint part 1, or a launch task opens on Marketing / ADs.",
    },
    {
      id: "nothing",
      name: "Nothing running",
      rule: "Active or paused, no spend in 7 days",
      empty: "Every active client has a campaign running.",
    },
    {
      id: "waiting",
      name: "Waiting for spend",
      rule: "Created or switched on, awaiting first spend",
      empty: "No launch is waiting for its first spend.",
    },
    {
      id: "ads",
      name: "In Ads",
      rule: "Campaigns listed in the Ads section",
      empty: "No campaign is listed in Ads yet.",
    },
  ];
export function accountStatus(status: number | null) {
  return status === 1
    ? "Active"
    : status === 3
      ? "Unpaid balance"
      : status === 2
        ? "Disabled"
        : status === 100 || status === 101
          ? "Closed"
          : status === 9
            ? "Payment grace period"
            : status === 7 || status === 8
              ? "Payment in review"
              : "Not in Meta’s hourly read";
}
export function accountTone(status: number | null) {
  return status === 1
    ? "ok"
    : [2, 3, 100, 101].includes(status ?? 0)
      ? "block"
      : status === null
        ? "unknown"
        : "warn";
}
export function defaultAccount(c: LaunchClient) {
  return [...c.accounts].sort(
    (a, b) =>
      Number(b.status === 1) - Number(a.status === 1) ||
      String(b.lastRan ?? "").localeCompare(String(a.lastRan ?? "")),
  )[0];
}
export function launchAge(l: LaunchRow, now = Date.now()) {
  return (now - new Date(l.switched_on_at ?? l.created_at).getTime()) / 3600000;
}
export function firstBlock(c: LaunchClient) {
  const a = defaultAccount(c),
    l = c.launches.find(l => !l.inAds);
  if (c.readOnly) return "Stopped client, history only";
  if (l?.state === "reconcile") return "Needs reconciliation";
  if (l?.state === "built") return "Created paused, ready for review";
  if (l?.hasImpressions) return "First impressions recorded, waiting for Ads";
  if (l?.state === "switched_on")
    return launchAge(l) > 24
      ? "No impressions after 24 hours"
      : "Switched on, waiting for impressions";
  if (!a) return "No ad account linked";
  if (a.status !== 1) return accountStatus(a.status);
  if (c.lane === "onboarding" && !c.brief?.sentAt) return "Blueprint part 1";
  if (c.caller === false && c.serviceMode === "DFY")
    return "Caller not assigned";
  if (c.caller === null && c.serviceMode === "DFY")
    return "Caller assignment not checked";
  if (c.lane === "nothing") return "Not spending";
  return "Review account and launch plan";
}
export function nextAction(c: LaunchClient) {
  if (c.readOnly) return "View history";
  if (c.launches.some(l => l.state === "reconcile")) return "Review launch";
  if (!c.accounts.length) return "Link an ad account";
  if (c.accounts.some(a => a.status === 3)) return "Move to a clean account";
  if (c.launches.some(l => l.state === "built" && !l.inAds)) return "Switch on";
  if (c.waiting) return "Check delivery";
  if (c.lane === "ready") return "Launch";
  if (c.lane === "nothing")
    return c.history?.some(h => h.owner?.kind === "mahara")
      ? "Relaunch"
      : "Check why it is not spending";
  return "Open";
}
export function laneClients(p: LaunchPipeline, lane: Lane) {
  return p.clients
    .filter(
      c => !c.readOnly && (lane === "waiting" ? c.waiting : c.lane === lane),
    )
    .sort((a, b) => {
      const rank = (c: LaunchClient) =>
        !c.accounts.length ? 2 : defaultAccount(c)?.status === 1 ? 0 : 1;
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });
}
export function justLaunched(p: LaunchPipeline) {
  return p.clients.flatMap(c =>
    c.launches
      .filter(l => !l.inAds && l.hasImpressions && l.state === "switched_on")
      .map(l => ({ client: c, launch: l })),
  );
}
export function bestPast(c: LaunchClient) {
  const names = new Set(
    (c.people ?? []).filter(p => p.kind === "mahara").map(p => p.name),
  );
  const rows = c.history.filter(
    h => names.has(h.creator) && h.leads >= 3 && h.cpl != null,
  );
  const good = rows.filter(h => h.cpl < CPL_GATE);
  return (
    good.length
      ? good.sort((a, b) => b.leads - a.leads)
      : rows.sort((a, b) => a.cpl - b.cpl)
  )[0];
}
// ---------------------------------------------------------------------------
// The agreed daily budget (item 5, 20261103e). One chain, newest agreed first:
// the Ads card's Daily Ad Spend, Blueprint part 1 as sent, the kickoff in
// dollars, then the sale (the card's Daily Budget). The server's
// cockpit_launch_agreed_chain is the same rule; launch-agreed-budget-supabase
// holds the two equal. Missing is never zero: no source gives usd null.

/**
 * A Blueprint, kickoff or sale figure at or over this is never the default
 * (a month, or another currency). The Blueprint is prefilled from the sale's
 * card Daily Budget, so the sale's guard holds there too.
 */
export const SALE_GUARD_USD = 1000;
/** The desk's lowest daily budget (cockpit-media-api budgetCheck). */
export const DESK_FLOOR_USD = 5;

/** A positive dollar figure from a number or a plain numeric string, to the cent. */
export function budgetUsd(v: unknown): number | null {
  let n: number | null = null;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && /^[0-9]{1,9}(\.[0-9]+)?$/.test(v.trim()))
    n = Number(v.trim());
  if (n === null || !Number.isFinite(n) || n <= 0) return null;
  // To the cent, half away from zero as PostgreSQL's round(n, 2): 1.005 is 1.01.
  const cents = Number(`${Math.round(Number(`${n}e2`))}e-2`);
  return cents > 0 && cents < 1e9 ? cents : null;
}

/** Dollars as format.ts money() writes them: $39.99, $40, $1,000. */
export function usdWords(v: number): string {
  const abs = Math.abs(v);
  if (abs < 100 && Math.round(abs * 100) % 100 !== 0)
    return `$${abs.toFixed(2)}`;
  return `$${Math.round(abs).toLocaleString("en-US")}`;
}

/** The Blueprint's figure: {usd, said} as stored, or a bare figure. */
export function blueprintUsd(dailyBudget: unknown): number | null {
  return dailyBudget && typeof dailyBudget === "object"
    ? budgetUsd((dailyBudget as { usd?: unknown }).usd)
    : budgetUsd(dailyBudget);
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Why a figure is not the default, or null: twice it is under the desk's $5
 * floor, so no budget could pass; or, with `ask`, it is $1,000 or more. The
 * server's cockpit_launch_budget_hold is the same rule.
 */
export function budgetHold(
  whose: string,
  usd: number | null,
  ask: string | null,
): string | null {
  if (usd === null) return null;
  if (usd * 2 < DESK_FLOOR_USD)
    return `${whose} ${usdWords(usd)} a day is too low: twice it is under the desk's $5 floor, so it is not the default.`;
  if (ask !== null && usd >= SALE_GUARD_USD)
    return `${whose} ${usdWords(usd)} a day looks like a month or another currency, so it is not the default. Ask the ${ask}.`;
  return null;
}

export function agreedBudget(
  c: Pick<LaunchClient, "cards" | "brief" | "kickoffBudget" | "handover"> &
    Partial<Pick<LaunchClient, "adsCards">>,
): AgreedBudget {
  const sources: BudgetSource[] = [];
  const add = (s: Omit<BudgetSource, "used">) =>
    sources.push({ ...s, used: false });

  // The mirror's cards, then cockpit-sync's Ads card figures (the mirror omits
  // Daily Ad Spend). By task id as PostgreSQL orders text (byte order), a card
  // with none last, then as listed (the sort is stable).
  const card = [
    ...(Array.isArray(c.cards) ? c.cards : []),
    ...(Array.isArray(c.adsCards) ? c.adsCards : []),
  ]
    .filter(x => budgetUsd(x?.dailyAdSpend) !== null)
    .sort((a, b) => {
      const x = a.taskId == null ? null : String(a.taskId);
      const y = b.taskId == null ? null : String(b.taskId);
      return x === y ? 0 : x === null ? 1 : y === null ? -1 : x < y ? -1 : 1;
    })[0];
  if (card) {
    const usd = budgetUsd(card.dailyAdSpend);
    add({
      key: "adsCard",
      label: "Ads card",
      from: "the Ads card",
      usd,
      note: budgetHold("The Ads card's", usd, null),
    });
  }

  // Blueprint part 1: the figure as sent (sentBudget) once part 1 is sent; a
  // draft that differs is listed with a note, never the default.
  const brief = c.brief && typeof c.brief === "object" ? c.brief : null;
  const bp = brief ? blueprintUsd(brief.answers?.daily_budget) : null;
  const bpSent = !!brief?.sentAt;
  const bpWas = bpSent ? blueprintUsd(brief?.sentBudget) : null;
  if (bpWas !== null)
    add({
      key: "blueprint",
      label: "Blueprint part 1",
      from: "Blueprint part 1",
      usd: bpWas,
      note: budgetHold("Blueprint part 1's", bpWas, "creative director"),
    });
  if (bp !== null && bp !== bpWas)
    add({
      key: bpWas === null ? "blueprint" : "blueprintDraft",
      label:
        bpWas === null
          ? "Blueprint part 1"
          : "Blueprint part 1, change not sent",
      from: bpWas === null ? "Blueprint part 1" : "the unsent Blueprint change",
      usd: bp,
      note: bpSent
        ? `Blueprint part 1 now says ${usdWords(bp)} a day but the change is not sent yet, so it is not the default.`
        : `Blueprint part 1 says ${usdWords(bp)} a day but is not sent yet, so it is not the default.`,
    });

  const k = c.kickoffBudget;
  if (k && typeof k === "object") {
    const usd = budgetUsd(k.usd);
    const amount = budgetUsd(k.amount);
    const cur = k.currency || null;
    if (usd !== null || amount !== null) {
      const label =
        k.fromText === true
          ? `Kickoff, as typed: ${k.said || (usd !== null ? usdWords(usd) : String(amount))}`
          : cur && cur !== "USD" && amount !== null
            ? `Kickoff, ${amount} ${cur}`
            : "Kickoff";
      add({
        key: "kickoff",
        label,
        from: lowerFirst(label),
        usd,
        note:
          usd === null && cur === null
            ? `The kickoff's ${amount} has no currency, so it is not the default.`
            : usd === null
              ? `No fixed rate for ${cur} yet, so the kickoff's ${amount} ${cur} is not the default.`
              : budgetHold("The kickoff's", usd, "CSM"),
      });
    }
  }

  const sale =
    c.handover && typeof c.handover === "object"
      ? budgetUsd(c.handover.daily_budget)
      : null;
  if (sale !== null)
    add({
      key: "sale",
      label: "Sale (card Daily Budget)",
      from: "the sale",
      usd: sale,
      note:
        budgetHold("The sale's", sale, null) ??
        (sale >= SALE_GUARD_USD
          ? `The sale's figure, ${usdWords(sale)} a day, looks like a month or another currency, so it is not the default. Ask the CSM.`
          : null),
    });

  const pick = sources.find(s => s.usd !== null && s.note === null);
  if (pick) pick.used = true;
  return {
    usd: pick?.usd ?? null,
    key: pick?.key ?? null,
    source: pick?.label ?? null,
    from: pick?.from ?? null,
    sources,
    notes: sources.flatMap(s => (s.note ? [s.note] : [])),
  };
}

/** The server's chain when the pipeline sent it, else the same rule here. */
export function clientAgreedBudget(c: LaunchClient): AgreedBudget {
  return c.agreedBudget && Array.isArray(c.agreedBudget.sources)
    ? c.agreedBudget
    : agreedBudget(c);
}

/** The desk's default budget and its source, or null with none agreed. */
export function contractedBudget(c: LaunchClient) {
  const a = clientAgreedBudget(c);
  return a.usd !== null && a.source !== null
    ? { value: a.usd, source: a.source }
    : null;
}

/**
 * The sources the desk lists under the budget field: the chain's, with the
 * live Ads card the readiness read first and the default (cockpit-media-api
 * reads the card itself before setting the cap). It takes the place of the
 * chain's Ads card figure, which is cockpit-sync's copy and can lag the card.
 */
export function deskBudgetSources(
  a: AgreedBudget,
  live?: { contractedUsd?: number | null; source?: string | null } | null,
): BudgetSource[] {
  const usd = budgetUsd(live?.contractedUsd);
  if (live?.source !== "Ads card" || usd === null) return a.sources;
  const mirrored = a.sources.find(s => s.key === "adsCard");
  if (mirrored?.used && mirrored.usd === usd) return a.sources;
  return [
    {
      key: "adsCard",
      label: "Ads card",
      from: "the Ads card",
      usd,
      used: true,
      note: null,
    },
    ...a.sources
      .filter(s => s.key !== "adsCard")
      .map(s => ({ ...s, used: false })),
  ];
}

/** "$40 a day" for Blueprint part 1's figure, whatever its stored shape. */
export function briefBudgetWords(dailyBudget: unknown): string | null {
  const usd = blueprintUsd(dailyBudget);
  return usd === null ? null : `${usdWords(usd)} a day`;
}
export const launchHref = (id: string) =>
  `/clients?client=${encodeURIComponent(id)}`;
export const adsHref = (c: LaunchClient) =>
  `/ads?account=${encodeURIComponent(c.name)}&adAccounts=${encodeURIComponent(c.accounts.map(a => a.id).join(","))}`;
