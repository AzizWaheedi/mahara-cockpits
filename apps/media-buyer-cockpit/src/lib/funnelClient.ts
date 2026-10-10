import { useCallback, useEffect, useRef, useState } from "react";
import { type FunnelStats, parseStats } from "./funnelStats";
import type { LeadFormSpec } from "./leadForm";
import { mediaAction } from "./mediaActionsClient";
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

export type { FunnelStats, RangeTotals } from "./funnelStats";
export { leftOut, totalsFor } from "./funnelStats";

/**
 * The campaign's daily numbers and booked calls for these dates, the same
 * read as the panel's range table, counted by Meta ad id in funnelStats.ts.
 */
export function useFunnelStats(
  campaignName: string | null,
  range: { start: string; end: string },
): Loaded<FunnelStats> {
  return useOnce(
    campaignName ? `${campaignName}|${range.start}|${range.end}` : null,
    async () => {
      const { data, error } = await supabase.rpc("cockpit_media_statistics", {
        p_kind: "range",
        p_campaign: campaignName,
        p_start: range.start,
        p_end: range.end,
      });
      if (error) throw new Error(error.message);
      return parseStats(data);
    },
  );
}
