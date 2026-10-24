import { useCallback, useEffect, useRef, useState } from "react";
import { mediaAction } from "./mediaActionsClient";
import type { PageFormSpec } from "./pageForm";

/**
 * A client's own form pages (Lead page on the client page), all through
 * cockpit-media-api: pageForms.read, pageForms.publish, pageForms.switch.
 * Publish and switch go live at once (Muhammed, 2026-10-22); without apply
 * they only check and say what would change.
 */

export type PageFormVersion = {
  version: number;
  label: string;
  summary: string;
  source: "build" | "cockpit";
  by: string | null;
  at: string;
  /** When the public file first held this version; null if it never went live. */
  wentLive: string | null;
  live: boolean;
};

export type PageFormPage = {
  slug: string;
  title: string;
  siteUrl: string;
  publicUrl: string;
  photos: string[];
  /** Launch question key -> its own GHL field's query key. */
  bindings: Record<string, string>;
  /** 0 until the first publish: the page then shows the questions it was built with. */
  liveVersion: number;
  current: (PageFormSpec & { version: string }) | null;
  currentUnreadable?: string;
  retired: string[];
  versions: PageFormVersion[];
};

export type PageFormChange = {
  ok: true;
  receiptId: string;
  version: number;
  label: string;
  did: string;
};

export type PageFormCheck = {
  problems: string[];
  summary?: string;
  error?: string;
};

export async function readPageForms(client: string): Promise<PageFormPage[]> {
  const data = (await mediaAction("pageForms.read", { client })) as {
    pages?: PageFormPage[];
  };
  if (!Array.isArray(data?.pages))
    throw new Error("The cockpit did not return this client's pages.");
  return data.pages;
}

type PublishArgs = { slug: string; base: number; spec: PageFormSpec };

/** The server's own check of a draft. Nothing is published. */
export async function checkPageForm(args: PublishArgs): Promise<PageFormCheck> {
  const data = (await mediaAction("pageForms.publish", args)) as PageFormCheck;
  return {
    problems: Array.isArray(data?.problems) ? data.problems : [],
    summary: data?.summary,
    error: data?.error,
  };
}

export async function publishPageForm(
  args: PublishArgs,
): Promise<PageFormChange> {
  return (await mediaAction("pageForms.publish", args, {
    apply: true,
  })) as PageFormChange;
}

export async function switchPageForm(args: {
  slug: string;
  base: number;
  version: number;
}): Promise<PageFormChange> {
  return (await mediaAction("pageForms.switch", args, {
    apply: true,
  })) as PageFormChange;
}

/** One screen of the drop-off funnel: visits that reached it. */
export type FunnelStep = {
  screen: string;
  label: string;
  name?: string | null;
  visits: number;
};

/** "ads": visits whose link carried a Meta ad or campaign id. "all": every visit. */
export type FunnelSource = "ads" | "all";

export type PageFormFunnel = {
  slug: string;
  version: string;
  liveVersion: string;
  days: number;
  source: FunnelSource;
  /** Visits in the range, all versions: from ads, and in all. */
  counts: { all: number; ads: number };
  since: string;
  steps: FunnelStep[];
  /** Versions with any counted visit in the range. */
  versions: { version: string; visits: number }[];
  lastAt: string | null;
  hosts: string[];
};

/** Where visitors stop, for one version of a page (pageForms.funnel). */
export async function readPageFormFunnel(args: {
  slug: string;
  version?: string;
  days: number;
  source: FunnelSource;
}): Promise<PageFormFunnel> {
  const data = (await mediaAction("pageForms.funnel", args)) as PageFormFunnel;
  if (!Array.isArray(data?.steps))
    throw new Error("The cockpit did not return the drop-off counts.");
  return data;
}

export function usePageFormFunnel(
  slug: string,
  version: string | undefined,
  days: number,
  source: FunnelSource,
  tick: number,
) {
  const [data, setData] = useState<PageFormFunnel | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [again, setAgain] = useState(0);
  const latest = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick and again are reload triggers
  useEffect(() => {
    const run = ++latest.current;
    setLoading(true);
    setError(null);
    readPageFormFunnel({ slug, version, days, source })
      .then(f => {
        if (run === latest.current) setData(f);
      })
      .catch(err => {
        if (run === latest.current)
          setError(err instanceof Error ? err.message : String(err ?? ""));
      })
      .finally(() => {
        if (run === latest.current) setLoading(false);
      });
  }, [slug, version, days, source, tick, again]);

  const reload = useCallback(() => setAgain(t => t + 1), []);
  return { data, error, loading, reload };
}

export type PageFormsRead = {
  data: PageFormPage[] | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
};

/** The client's pages, read once when the client page opens and again on reload. */
export function usePageForms(client: string | null): PageFormsRead {
  const [data, setData] = useState<PageFormPage[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the reload trigger
  useEffect(() => {
    if (!client) return;
    const run = ++latest.current;
    setLoading(true);
    setError(null);
    readPageForms(client)
      .then(pages => {
        if (run === latest.current) setData(pages);
      })
      .catch(err => {
        if (run === latest.current)
          setError(err instanceof Error ? err.message : String(err ?? ""));
      })
      .finally(() => {
        if (run === latest.current) setLoading(false);
      });
  }, [client, tick]);

  const reload = useCallback(() => setTick(t => t + 1), []);
  return { data, error, loading, reload };
}
