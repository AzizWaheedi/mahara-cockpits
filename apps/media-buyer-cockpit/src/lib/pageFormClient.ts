import { useCallback, useEffect, useRef, useState } from "react";
import { pageForUrl } from "./leadPageFunnel";
import { mediaAction } from "./mediaActionsClient";
import type { PageFormSpec } from "./pageForm";
import { supabase } from "./supabase";

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
  /** null reads nothing (a campaign whose ads open no client page). */
  slug: string | null,
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
    if (!slug) return;
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

/** One client form page, for a link to it (cockpit_page_forms_listed, 20261026s). */
export type PageFormListed = {
  slug: string;
  client: string;
  title: string;
  siteUrl: string;
};

let listed: Promise<PageFormListed[]> | null = null;

/**
 * Every client form page this seat may see, read once per page load and
 * shared, so the board links each client with a page to its Lead page
 * without one read per client. A failed read is not kept.
 */
export function readPageFormList(): Promise<PageFormListed[]> {
  listed ??= (async () => {
    const { data, error } = await supabase.rpc("cockpit_page_forms_listed");
    if (error) throw new Error(error.message);
    if (!Array.isArray(data))
      throw new Error("The cockpit did not return the lead pages.");
    return data.filter(
      (p): p is PageFormListed =>
        typeof p?.slug === "string" && typeof p?.client === "string",
    );
  })().catch(err => {
    listed = null;
    throw err;
  });
  return listed;
}

/** The pages this seat may see; undefined while reading and after a failed read. */
export function usePageFormList(): PageFormListed[] | undefined {
  const [list, setList] = useState<PageFormListed[] | undefined>(undefined);
  useEffect(() => {
    let live = true;
    readPageFormList()
      .then(l => {
        if (live) setList(l);
      })
      // No list means no link; the client page still shows its Lead page.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return list;
}

/** The client's page, matched on the name as cockpit_page_form_scope matches it. */
export function pageFormFor(
  list: PageFormListed[] | undefined,
  client: string | undefined,
): PageFormListed | undefined {
  const key = (client ?? "").trim().toLowerCase();
  return key
    ? list?.find(p => p.client.trim().toLowerCase() === key)
    : undefined;
}

export type LeadPageRead = {
  /** The ad link that opens the page; null when no link opens a client page. */
  url: string | null;
  page: PageFormPage | undefined;
  /** The client's pages were read; with no `page`, the link's page is not the client's. */
  checked: boolean;
  error: string | null;
  loading: boolean;
  reload: () => void;
  /** Visits from ads over `days`, for the live version. */
  visits: ReturnType<typeof usePageFormFunnel>;
  days: number;
};

/**
 * The client form page that a campaign's website ads open, for Open funnel:
 * the page with its live questions and versions, and its visits from ads.
 * Nothing is read for a campaign whose links open no client page.
 */
export function useLeadPage(urls: string[], days: number): LeadPageRead {
  const list = usePageFormList();
  const hit = urls
    .map(url => ({ url, listed: pageForUrl(list, url) }))
    .find(x => x.listed);
  const read = usePageForms(hit?.listed?.client ?? null);
  const page = read.data?.find(p => p.slug === hit?.listed?.slug);
  const visits = usePageFormFunnel(
    page?.slug ?? null,
    undefined,
    days,
    "ads",
    page?.liveVersion ?? 0,
  );
  return {
    url: hit?.url ?? null,
    page,
    checked: read.data !== undefined,
    error: read.error,
    loading: read.loading,
    reload: read.reload,
    visits,
    days,
  };
}
