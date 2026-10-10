import { useCallback, useEffect, useRef, useState } from "react";
import type { LeadFormSpec } from "./leadForm";
import { mediaAction } from "./mediaActionsClient";
import { readMediaStats } from "./mediaStatsClient";
import { supabase } from "./supabase";

/**
 * The funnel view's reads and writes, all through cockpit-media-api
 * (funnel.read, forms.publish, forms.switch). Reads go to Meta live, so they
 * run once when the view opens and again only when asked; a refused read stays
 * in its own card instead of taking the page down.
 */

export type FunnelKind =
  | "form"
  | "website"
  | "whatsapp"
  | "messenger"
  | "instagram"
  | "call"
  | "unknown";

export type FunnelAd = {
  id: string;
  name: string;
  status: string;
  creativeId: string | null;
};

export type PageForm = {
  id: string;
  name: string;
  status: string;
  createdTime: string | null;
  leadsAllTime: number | null;
};

export type FunnelForm = {
  id: string;
  name: string;
  status: string;
  createdTime: string | null;
  leadsAllTime: number | null;
  followUpUrl: string | null;
  spec: LeadFormSpec;
  /** False when Meta returned only the basic fields (no greeting, thank-you or quality settings). */
  full: boolean;
};

export type FunnelDestination = {
  kind: FunnelKind;
  formId?: string;
  url?: string;
  pageId?: string | null;
  pageName?: string | null;
  ads: FunnelAd[];
  form?: FunnelForm;
  versions?: PageForm[];
  /** Why Meta would not show the form, in words. */
  unreadable?: string;
};

export type FunnelRead = {
  campaign: string;
  campaignName: string;
  destinations: FunnelDestination[];
  readAt: string;
};

export type AdCheck = {
  adId: string;
  name: string;
  status: string;
  ok: boolean;
  why?: string;
};

export type FormCheck = {
  ready: boolean;
  pageId: string;
  pageName: string | null;
  name: string;
  version?: number;
  ads: AdCheck[];
};

export type FormChange = {
  ok: true;
  did: string;
  formId: string;
  formName?: string;
  version?: number;
  switched: string[];
  receiptId?: string;
};

export async function readFunnel(campaignName: string): Promise<FunnelRead> {
  const data = await mediaAction("funnel.read", { campaignName });
  if (!data || !Array.isArray(data.destinations))
    throw new Error("Meta did not return this campaign's ads. Try again.");
  return data as FunnelRead;
}

export type PublishArgs = {
  campaignName: string;
  fromFormId: string;
  spec: LeadFormSpec;
  adIds?: string[];
};

export type SwitchArgs = {
  campaignName: string;
  toFormId: string;
  fromFormId?: string;
  adIds?: string[];
};

function checkOf(data: unknown): FormCheck {
  const check = (data as { plan?: { check?: FormCheck } })?.plan?.check;
  if (!check || !Array.isArray(check.ads))
    throw new Error("Meta did not answer the check. Try again.");
  return check;
}

/** Rehearses the change with Meta. Nothing is created. */
export async function checkPublish(args: PublishArgs): Promise<FormCheck> {
  return checkOf(await mediaAction("forms.publish", args));
}

export async function publishForm(args: PublishArgs): Promise<FormChange> {
  return (await mediaAction("forms.publish", args, {
    apply: true,
  })) as FormChange;
}

/** Rehearses moving ads onto another form already on the Page. */
export async function checkSwitch(args: SwitchArgs): Promise<FormCheck> {
  return checkOf(await mediaAction("forms.switch", args));
}

export async function switchForms(args: SwitchArgs): Promise<FormChange> {
  return (await mediaAction("forms.switch", args, {
    apply: true,
  })) as FormChange;
}

type Loaded<T> = {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
};

/** One read, a manual reload, and the error as words. Never throws into the page. */
function useOnce<T>(key: string | null, load: () => Promise<T>): Loaded<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const loader = useRef(load);
  loader.current = load;

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the reload trigger
  useEffect(() => {
    if (!key) return;
    let live = true;
    setLoading(true);
    setError(null);
    loader
      .current()
      .then(result => {
        if (live) setData(result);
      })
      .catch(err => {
        if (live)
          setError(err instanceof Error ? err.message : String(err ?? ""));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [key, tick]);

  const reload = useCallback(() => setTick(t => t + 1), []);
  return { data, error, loading, reload };
}

export function useFunnel(campaignName: string | null): Loaded<FunnelRead> {
  return useOnce(campaignName, () => readFunnel(campaignName ?? ""));
}

export type RangeTotals = {
  spend: number;
  impressions: number;
  linkClicks: number;
  leads: number;
  bookings: number;
  showed: number;
};

export type FunnelStats = {
  total: RangeTotals;
  /** The range table's rows: one per ad name, with every Meta ad id that name covers. */
  rows: { ids: string[]; totals: RangeTotals }[];
  hasData: boolean;
};

const ZERO: RangeTotals = {
  spend: 0,
  impressions: 0,
  linkClicks: 0,
  leads: 0,
  bookings: 0,
  showed: 0,
};

/** The campaign's range numbers, the same read the panel's ads table uses. */
export function useFunnelStats(
  campaignName: string | null,
  range: { start: string; end: string },
): Loaded<FunnelStats> {
  return useOnce(
    campaignName ? `${campaignName}|${range.start}|${range.end}` : null,
    async () => {
      const data: any = await readMediaStats(supabase, "range", {
        campaignName,
        start: range.start,
        end: range.end,
      });
      const pick = (r: Record<string, unknown> | undefined): RangeTotals => ({
        spend: Number(r?.spend ?? 0),
        impressions: Number(r?.impressions ?? 0),
        linkClicks: Number(r?.linkClicks ?? 0),
        leads: Number(r?.leads ?? 0),
        bookings: Number(r?.bookings ?? 0),
        showed: Number(r?.showed ?? 0),
      });
      const rows = ((data?.ads ?? []) as Record<string, unknown>[]).map(
        row => ({
          ids: ((row.adIds ?? []) as unknown[]).map(String),
          totals: pick(row),
        }),
      );
      return {
        total: pick(data?.total),
        rows,
        hasData: Boolean(data?.hasData),
      };
    },
  );
}

/** The sum of the ads in one destination, or null when none of them has numbers. */
export function totalsFor(
  stats: FunnelStats | undefined,
  ads: FunnelAd[],
): RangeTotals | null {
  if (!stats) return null;
  const mine = new Set(ads.map(a => a.id));
  let found = false;
  const sum = { ...ZERO };
  // A row covers every ad sharing a name; it counts once if any of them is here.
  for (const row of stats.rows) {
    if (!row.ids.some(id => mine.has(id))) continue;
    found = true;
    for (const k of Object.keys(sum) as (keyof RangeTotals)[])
      sum[k] += row.totals[k];
  }
  return found ? sum : null;
}
