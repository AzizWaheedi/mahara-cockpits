/**
 * Which funnel each campaign feeds, for the client page's split
 * (cockpit_media_campaign_funnels, 20261026s). Muhammed, 2026-10-26: the page
 * has to say whether its numbers come from the instant form or the lead page
 * built for the client. The numbers stay the media data's; this read only
 * names each campaign's funnel, from Meta's ad set destinations, and gives
 * Meta's link clicks and landing page views for the Lead page.
 */
export type FunnelKind =
  | "form"
  | "website"
  | "whatsapp"
  | "messenger"
  | "instagram"
  | "chat"
  | "other"
  | "unknown";

export type CampaignFunnel = {
  campaign: string;
  /** The funnel the campaign spent most on (unknown only when nothing else is known). */
  kind: FunnelKind;
  /** Every funnel it ran, most spend first. */
  kinds: { kind: FunnelKind; spend: number }[];
  /** Meta's link clicks and landing page views in the range read; null when Meta gave none. */
  linkClicks: number | null;
  landingPageViews: number | null;
};

/** A second funnel with at least this share of a campaign's spend makes the campaign mixed. */
export const MIXED_SHARE = 0.1;

const KINDS: FunnelKind[] = [
  "form",
  "website",
  "whatsapp",
  "messenger",
  "instagram",
  "chat",
  "other",
  "unknown",
];

const NAMES: Record<FunnelKind, string> = {
  form: "Instant form",
  website: "Website",
  whatsapp: "WhatsApp",
  messenger: "Messenger",
  instagram: "Instagram DM",
  chat: "Chat",
  other: "Other ads",
  unknown: "Funnel not known",
};

/** A website campaign is the client's Lead page when the client has one. */
export function funnelName(kind: FunnelKind, hasLeadPage: boolean): string {
  return kind === "website" && hasLeadPage ? "Lead page" : NAMES[kind];
}

/** The other funnels a campaign spent at least MIXED_SHARE of its known spend on. */
export function alsoRuns(f: CampaignFunnel | undefined): FunnelKind[] {
  if (!f) return [];
  const known = f.kinds.filter(k => k.kind !== "unknown");
  const total = known.reduce((s, k) => s + k.spend, 0);
  if (total <= 0) return [];
  return known
    .filter(k => k.kind !== f.kind && k.spend / total >= MIXED_SHARE)
    .map(k => k.kind);
}

export type FunnelLine = {
  kind: FunnelKind;
  name: string;
  spend: number;
  leads: number;
  cpl: number | undefined;
  /** This line's share of the spend split here, 0 to 1. */
  share: number;
  campaigns: string[];
  /** Campaigns in this line that also spent on another funnel. */
  mixed: string[];
};

/**
 * The client's numbers by funnel. Each campaign's own spend and leads go,
 * whole, to the funnel it spent most on; a campaign the read does not name
 * is "Funnel not known", never left out. The funnel doing the work comes
 * first. Lines with no spend and no leads are dropped.
 */
export function splitByFunnel(
  rows: { campaign: string; spend: number | null; leads: number | null }[],
  funnels: CampaignFunnel[] | undefined,
  hasLeadPage: boolean,
): FunnelLine[] {
  const by = new Map((funnels ?? []).map(f => [f.campaign, f]));
  const lines = new Map<FunnelKind, FunnelLine>();
  for (const r of rows) {
    if (r.spend === null && r.leads === null) continue;
    const f = by.get(r.campaign);
    const kind = f?.kind ?? "unknown";
    const line = lines.get(kind) ?? {
      kind,
      name: funnelName(kind, hasLeadPage),
      spend: 0,
      leads: 0,
      cpl: undefined,
      share: 0,
      campaigns: [],
      mixed: [],
    };
    line.spend += r.spend ?? 0;
    line.leads += r.leads ?? 0;
    line.campaigns.push(r.campaign);
    if (alsoRuns(f).length) line.mixed.push(r.campaign);
    lines.set(kind, line);
  }
  const total = [...lines.values()].reduce((s, l) => s + l.spend, 0);
  return [...lines.values()]
    .filter(l => l.spend > 0 || l.leads > 0)
    .map(l => ({
      ...l,
      cpl: l.leads > 0 ? l.spend / l.leads : undefined,
      share: total > 0 ? l.spend / total : 0,
    }))
    .sort(
      (a, b) =>
        b.spend - a.spend || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind),
    );
}

const num = (v: unknown): number | null =>
  v === null || v === undefined || !Number.isFinite(Number(v))
    ? null
    : Number(v);
const kindOf = (v: unknown): FunnelKind =>
  KINDS.includes(v as FunnelKind) ? (v as FunnelKind) : "unknown";

/** One row of the read, checked: anything unexpected becomes unknown or null. */
export function parseFunnel(x: unknown): CampaignFunnel | null {
  const r = (x ?? {}) as Record<string, unknown>;
  if (typeof r.campaign !== "string" || !r.campaign) return null;
  return {
    campaign: r.campaign,
    kind: kindOf(r.kind),
    kinds: (Array.isArray(r.kinds) ? r.kinds : []).map(k => {
      const kk = (k ?? {}) as Record<string, unknown>;
      return { kind: kindOf(kk.kind), spend: num(kk.spend) ?? 0 };
    }),
    linkClicks: num(r.linkClicks),
    landingPageViews: num(r.landingPageViews),
  };
}
