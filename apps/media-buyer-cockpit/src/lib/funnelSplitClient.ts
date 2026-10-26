import { useEffect, useRef, useState } from "react";
import { type CampaignFunnel, parseFunnel } from "./funnelSplit";
import { supabase } from "./supabase";

/** Each campaign's funnel, read through cockpit_media_campaign_funnels (20261026s). */
export async function readCampaignFunnels(
  campaigns: string[],
  start?: string,
  end?: string,
): Promise<CampaignFunnel[]> {
  const { data, error } = await supabase.rpc("cockpit_media_campaign_funnels", {
    p_campaigns: campaigns,
    p_start: start ?? null,
    p_end: end ?? null,
  });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data))
    throw new Error("The funnel read did not return a list.");
  return data.map(parseFunnel).filter((f): f is CampaignFunnel => f !== null);
}

/** The campaigns' funnels for a range; read again when the campaigns or the range change. */
export function useCampaignFunnels(
  campaigns: string[],
  start?: string,
  end?: string,
): { data: CampaignFunnel[] | undefined; error: string | null } {
  const key = JSON.stringify([
    [...new Set(campaigns)].sort(),
    start ?? null,
    end ?? null,
  ]);
  const [data, setData] = useState<CampaignFunnel[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  useEffect(() => {
    const [names, from, to] = JSON.parse(key) as [
      string[],
      string | null,
      string | null,
    ];
    const run = ++latest.current;
    setError(null);
    if (!names.length) {
      setData([]);
      return;
    }
    setData(undefined);
    readCampaignFunnels(names, from ?? undefined, to ?? undefined)
      .then(rows => {
        if (run === latest.current) setData(rows);
      })
      .catch(err => {
        if (run === latest.current)
          setError(err instanceof Error ? err.message : String(err ?? ""));
      });
  }, [key]);
  return { data, error };
}
