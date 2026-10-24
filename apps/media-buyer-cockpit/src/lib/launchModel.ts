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
export type LaunchClient = {
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
  links?: any;
  people?: any[];
  starterPack?: string;
  updatedAt?: string;
};
export type Lane = "onboarding" | "ready" | "nothing" | "waiting" | "ads";
export type LaunchPipeline = {
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
export function contractedBudget(c: LaunchClient) {
  for (const [value, source] of [
    [c.cards.find(x => Number(x.dailyAdSpend) > 0)?.dailyAdSpend, "Ads card"],
    [c.brief?.answers?.daily_budget, "Blueprint part 1"],
    [c.handover?.daily_budget, "Kickoff"],
  ] as const) {
    if (value != null && Number(value) > 0)
      return { value: Number(value), source };
  }
  return null;
}
export const launchHref = (id: string) =>
  `/launch?client=${encodeURIComponent(id)}`;
export const adsHref = (c: LaunchClient) =>
  `/ads?account=${encodeURIComponent(c.name)}&adAccounts=${encodeURIComponent(c.accounts.map(a => a.id).join(","))}`;
