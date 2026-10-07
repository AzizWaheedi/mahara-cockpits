import type { SupabaseClient } from "@supabase/supabase-js";

export interface DimensionsResult {
  serviceLines: string[];
  cities: string[];
  plays: number;
  clients: number;
}

export interface PlaybookRow {
  serviceLine: string;
  city: string;
  playType: string;
  interests: string[];
  spend: number;
  leads: number;
  cpl: number;
  clients: number;
  verdict: "Proven" | "Worked once" | "Expensive";
}

export interface CreativePatternRow {
  key: string;
  kind: "format" | "cta" | "copy" | "language";
  cpl: number;
  leads: number;
  clients: number;
}

export interface WinnerAdRow {
  adId: string;
  adName: string;
  client: string;
  serviceLine: string;
  city: string;
  format: string;
  cta?: string;
  headline?: string;
  body?: string;
  transcript?: string;
  hook?: string;
  voice?: string;
  thumbUrl?: string;
  spend: number;
  leads: number;
  cpl: number;
  origin?: string;
  isSaved?: boolean;
  isAuto?: boolean;
  savedAt?: number;
  savedBy?: string;
  savedByName?: string;
  savedNote?: string;
  savedRange?: {
    start: string;
    end: string;
    label?: string;
  };
  accountId?: string;
  stillUrl?: string;
  stillTinyUrl?: string;
  playType?: string;
  savedStats?: {
    spend: number;
    leads: number;
    cpl: number;
    linkCtr?: number;
    cpm?: number;
    bookings?: number;
    bookingsAttributed?: boolean;
    costPerBooking?: number;
  };
  stillLive?: boolean;
  retiredOn?: string;
  wonFrom?: string;
  wonTo?: string;
  copyTraits?: string[];
  interests?: string[];
  campaignName?: string;
}

const CPL_GATE = 15;
const MIN_SPEND = 100;

export async function fetchDimensions(
  client: SupabaseClient,
): Promise<DimensionsResult> {
  const { data: winners } = await client
    .from("winner_ads")
    .select("service_line, city, client");

  const lines = new Set<string>();
  const cities = new Set<string>();
  const clients = new Set<string>();

  for (const w of winners ?? []) {
    if (w.service_line) lines.add(w.service_line);
    if (w.city && w.city !== "Unknown") cities.add(w.city);
    if (w.client) clients.add(w.client);
  }

  return {
    serviceLines: [...lines].sort(),
    cities: [...cities].sort(),
    plays: (winners ?? []).length,
    clients: clients.size,
  };
}

export async function fetchPlaybook(
  client: SupabaseClient,
  args: { serviceLine?: string; city?: string },
): Promise<PlaybookRow[]> {
  let query = client.from("winner_ads").select("*");
  if (args.serviceLine) query = query.eq("service_line", args.serviceLine);
  if (args.city) query = query.eq("city", args.city);

  const { data, error } = await query;
  if (error) throw error;

  // Group by serviceLine + city + format/playType
  const groups = new Map<
    string,
    {
      serviceLine: string;
      city: string;
      playType: string;
      interests: string[];
      spend: number;
      leads: number;
      clients: Set<string>;
    }
  >();

  for (const r of data ?? []) {
    const serviceLine = r.service_line || "General";
    const city = r.city || "Everywhere";
    const playType = r.format || "video";
    const key = `${serviceLine}::${city}::${playType}`;

    const g = groups.get(key) ?? {
      serviceLine,
      city,
      playType,
      interests: [],
      spend: 0,
      leads: 0,
      clients: new Set<string>(),
    };

    g.spend += Number(r.spend || 0);
    g.leads += Number(r.leads || 0);
    if (r.client) g.clients.add(r.client);
    groups.set(key, g);
  }

  return [...groups.values()]
    .filter(g => g.spend >= MIN_SPEND && g.leads > 0)
    .map(g => {
      const cpl = Number((g.spend / g.leads).toFixed(2));
      return {
        serviceLine: g.serviceLine,
        city: g.city,
        playType: g.playType,
        interests: g.interests,
        spend: Math.round(g.spend),
        leads: g.leads,
        cpl,
        clients: g.clients.size,
        verdict:
          cpl <= CPL_GATE && g.clients.size > 1
            ? ("Proven" as const)
            : cpl <= CPL_GATE
              ? ("Worked once" as const)
              : ("Expensive" as const),
      };
    })
    .sort((a, b) => a.cpl - b.cpl);
}

export async function fetchCreativePatterns(
  client: SupabaseClient,
  args: { serviceLine?: string },
): Promise<CreativePatternRow[]> {
  let query = client.from("winner_ads").select("*");
  if (args.serviceLine) query = query.eq("service_line", args.serviceLine);

  const { data, error } = await query;
  if (error) throw error;

  type Bucket = {
    key: string;
    kind: "format" | "cta" | "copy" | "language";
    spend: number;
    leads: number;
    clients: Set<string>;
  };
  const buckets = new Map<string, Bucket>();

  const add = (
    kind: "format" | "cta" | "copy" | "language",
    key: string | null | undefined,
    spend: number,
    leads: number,
    clientName?: string,
  ) => {
    if (!key) return;
    const id = `${kind}::${key}`;
    const b = buckets.get(id) ?? {
      key,
      kind,
      spend: 0,
      leads: 0,
      clients: new Set<string>(),
    };
    b.spend += spend;
    b.leads += leads;
    if (clientName) b.clients.add(clientName);
    buckets.set(id, b);
  };

  for (const r of data ?? []) {
    const spend = Number(r.spend || 0);
    const leads = Number(r.leads || 0);
    if (r.format) add("format", r.format, spend, leads, r.client);
    if (r.cta) add("cta", r.cta, spend, leads, r.client);
    if (r.voice) add("copy", r.voice, spend, leads, r.client);
  }

  return [...buckets.values()]
    .filter(b => b.spend >= MIN_SPEND && b.leads > 0)
    .map(b => ({
      key: b.key,
      kind: b.kind,
      cpl: Number((b.spend / b.leads).toFixed(2)),
      leads: b.leads,
      clients: b.clients.size,
    }))
    .sort((a, b) => a.cpl - b.cpl);
}

export async function fetchWinners(
  client: SupabaseClient,
  args: { serviceLine?: string; origin?: string; limit?: number },
): Promise<WinnerAdRow[]> {
  let query = client.from("winner_ads").select("*");
  if (args.serviceLine) query = query.eq("service_line", args.serviceLine);
  if (args.origin && args.origin !== "all") {
    if (args.origin === "saved") query = query.eq("origin", "saved");
    else if (args.origin === "auto") query = query.neq("origin", "saved");
  }
  query = query.order("cpl", { ascending: true }).limit(args.limit ?? 40);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map(r => ({
    adId: r.ad_id,
    adName: r.ad_name || "Ad",
    client: r.client || "Client",
    serviceLine: r.service_line || "General",
    city: r.city || "Everywhere",
    format: r.format || "video",
    cta: r.cta || undefined,
    headline: r.headline || undefined,
    body: r.body || undefined,
    transcript: r.transcript || undefined,
    hook: r.hook || undefined,
    voice: r.voice || undefined,
    thumbUrl: r.thumb_url || undefined,
    spend: Number(r.spend || 0),
    leads: Number(r.leads || 0),
    cpl: Number(r.cpl || 0),
    origin: r.origin || undefined,
    isSaved: r.origin === "saved",
    isAuto: r.origin !== "saved",
    savedAt: r.first_seen_at ? new Date(r.first_seen_at).getTime() : undefined,
    savedBy: r.origin === "saved" ? r.saved_by || r.client : undefined,
    savedByName: r.origin === "saved" ? r.saved_by_name || r.client : undefined,
    savedNote: r.hook || undefined,
    savedRange:
      r.won_from && r.won_to ? { start: r.won_from, end: r.won_to } : undefined,
    accountId: r.account_id || undefined,
    stillUrl: r.still_url || undefined,
    stillTinyUrl: r.still_tiny_url || undefined,
    playType: r.format || "video",
    interests: [],
    copyTraits: [],
    savedStats: {
      spend: Number(r.spend || 0),
      leads: Number(r.leads || 0),
      cpl: Number(r.cpl || 0),
      bookings: 0,
    },
    stillLive: true,
  }));
}
