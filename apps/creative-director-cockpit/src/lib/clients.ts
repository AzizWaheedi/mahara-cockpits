import type { SupabaseClient } from "@supabase/supabase-js";

// biome-ignore lint/suspicious/noExplicitAny: generic client shapes
type Any = any;

const LIVE_STATUSES = new Set([
  "active",
  "launch booked",
  "ready for launch🚀",
  "ready for launch",
  "onboarding booked",
]);

const PRELAUNCH_STATUSES = new Set([
  "launch booked",
  "ready for launch🚀",
  "ready for launch",
  "onboarding booked",
]);

const DONE = new Set(["complete", "cancelled", "closed", "done", "live 🚀"]);

function isOpen(status?: string | null): boolean {
  return !DONE.has((status || "").toLowerCase());
}

export function isLive(status?: string | null): boolean {
  return LIVE_STATUSES.has((status || "").toLowerCase());
}

function isPrelaunch(status?: string | null): boolean {
  return PRELAUNCH_STATUSES.has((status || "").toLowerCase());
}

function norm(x?: string | null): string {
  return (x || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export interface ClientRosterItem {
  taskId: string;
  name: string;
  url?: string;
  clientStatus: string;
  happiness?: string;
  service?: string;
  launchDate?: number | string | null;
  prelaunch: boolean;
  docs: {
    brandDna?: string | null;
    offerCheatSheet?: string | null;
    blueprintForm?: string | null;
    drive?: string | null;
    history?: string | null;
    research?: string | null;
  };
  docsReady: boolean;
  openScripts: number;
  openVideos: number;
  hisMove: number;
  liveCampaigns: number;
}

export interface ClientRosterResult {
  clients: ClientRosterItem[];
  counts: {
    live: number;
    toContact: number;
    docsMissing: number;
  };
  toContact: string[];
  syncedAt: string | null;
}

export async function fetchClientRoster(
  client: SupabaseClient,
  allowedClients?: string[] | null,
): Promise<ClientRosterResult> {
  const allowedSet = allowedClients?.length
    ? new Set(allowedClients.map(norm))
    : null;

  const [profilesRes, campaignsRes, planRes] = await Promise.all([
    client.from("cockpit_client_profiles").select("*"),
    client.from("cockpit_campaigns").select("client_name, campaign_name, service_type"),
    client.from("cockpit_plan_items").select("*"),
  ]);

  const profiles = profilesRes.data ?? [];
  const campaigns = campaignsRes.data ?? [];
  const planItems = planRes.data ?? [];

  const rows: ClientRosterItem[] = [];

  for (const p of profiles) {
    const name = p.client_name || "Unnamed Client";
    if (allowedSet && !allowedSet.has(norm(name))) continue;

    const stage = p.stage || "Active";
    const overview = p.overview || {};
    const links = overview.links || {};
    const notes = p.notes || {};

    const clientCampaigns = campaigns.filter(c => norm(c.client_name) === norm(name));
    const clientPlans = planItems.filter(pl => norm(pl.client_name) === norm(name));
    const scripts = clientPlans.filter(pl => isOpen(pl.status));

    const brandDna = notes.brandDna || links.brandDna || null;
    const offerCheatSheet = notes.offerCheatSheet || links.offerCheatSheet || null;
    const docsReady = Boolean(brandDna && offerCheatSheet);

    rows.push({
      taskId: String(p.id),
      name,
      url: links.clickup || undefined,
      clientStatus: stage,
      happiness: p.health || "good",
      service: p.service || undefined,
      launchDate: overview.launchDate || null,
      prelaunch: isPrelaunch(stage),
      docs: {
        brandDna,
        offerCheatSheet,
        blueprintForm: links.blueprintForm || null,
        drive: links.drive || null,
        history: notes.clientHistory || null,
        research: notes.marketResearch || null,
      },
      docsReady,
      openScripts: scripts.length,
      openVideos: 0,
      hisMove: 0,
      liveCampaigns: clientCampaigns.length,
    });
  }

  rows.sort((a, b) => {
    if (a.prelaunch !== b.prelaunch) return a.prelaunch ? -1 : 1;
    return b.openScripts + b.hisMove - (a.openScripts + a.hisMove);
  });

  const toContact = rows.filter(r => r.prelaunch);
  return {
    clients: rows,
    counts: {
      live: rows.length,
      toContact: toContact.length,
      docsMissing: rows.filter(r => !r.docsReady).length,
    },
    toContact: toContact.map(r => r.name),
    syncedAt: profiles[0]?.synced_at ?? null,
  };
}

export async function fetchClientDetail(
  client: SupabaseClient,
  clientName: string,
): Promise<Any | null> {
  const normTarget = norm(clientName);

  const [profilesRes, campaignsRes, adsRes, planRes] = await Promise.all([
    client.from("cockpit_client_profiles").select("*"),
    client.from("cockpit_campaigns").select("*"),
    client.from("cockpit_ads").select("*"),
    client.from("cockpit_plan_items").select("*"),
  ]);

  const profile = (profilesRes.data ?? []).find(
    p => norm(p.client_name) === normTarget,
  );
  if (!profile) return null;

  const campaigns = (campaignsRes.data ?? []).filter(
    k => norm(k.client_name) === normTarget,
  );
  const campaignNames = new Set(campaigns.map(k => norm(k.campaign_name)));
  const ads = (adsRes.data ?? []).filter(a =>
    campaignNames.has(norm(a.campaign_name)),
  );
  const tasks = (planRes.data ?? []).filter(
    pl => norm(pl.client_name) === normTarget,
  );

  const overview = profile.overview || {};
  const links = overview.links || {};
  const notes = profile.notes || {};
  const kpi = profile.kpi || {};

  const totalLeads = ads.reduce((s, a) => s + Number(a.leads || 0), 0);

  const mappedAds = ads.map(a => ({
    adName: a.ad_name || "Ad",
    campaignName: a.campaign_name || "",
    spend: Number(a.spend || 0),
    leads: Number(a.leads || 0),
    cpl: Number(a.leads) > 0 ? Number((Number(a.spend) / Number(a.leads)).toFixed(2)) : 0,
    ctr: 0,
    thumbnailUrl: a.thumbnail_url || undefined,
    metaAdId: a.meta_ad_id || String(a.id),
    stillKey: a.meta_ad_id || String(a.id),
    stillUrl: a.still_url || undefined,
    stillTinyUrl: a.still_url || undefined,
  }));

  const mappedTasks = tasks.map(t => ({
    taskId: String(t.id),
    name: t.text || "Task",
    kind: "script",
    status: t.status || "open",
    url: undefined,
    createdAt: t.created_at ? new Date(t.created_at).getTime() : Date.now(),
    dueDate: t.due_date ? new Date(t.due_date).getTime() : undefined,
    assignees: [],
    open: isOpen(t.status),
  }));

  return {
    stats: {
      month: new Date().toLocaleString("default", { month: "short" }),
      booked: kpi.booked || 0,
      due: kpi.due || 0,
      shows: kpi.shows || 0,
      quotes: kpi.quotes || 0,
      closes: kpi.closes || 0,
      leads30: totalLeads,
      bookingRate: totalLeads > 0 ? Math.round(((kpi.booked || 0) / totalLeads) * 100) : null,
      showRate: null,
      quotationRate: null,
      closeRate: null,
      scannedAt: profile.synced_at || null,
    },
    client: {
      name: profile.client_name,
      url: links.clickup || undefined,
      clientStatus: profile.stage || "Active",
      happiness: profile.health || "good",
      service: profile.service || undefined,
      launchDate: overview.launchDate || null,
      phone: overview.phone || undefined,
      dosDonts: notes.dosDonts || [],
      updates: notes.updates || [],
      docs: {
        brandDna: notes.brandDna || links.brandDna || null,
        offerCheatSheet: notes.offerCheatSheet || links.offerCheatSheet || null,
        blueprintForm: links.blueprintForm || null,
        drive: links.drive || null,
        sheet: links.sheet || null,
        history: notes.clientHistory || null,
        research: notes.marketResearch || null,
      },
    },
    tasks: mappedTasks.filter(t => t.open),
    videos: [],
    posts: 0,
    allTasks: mappedTasks,
    touch: {
      lastTouchAt: null,
      daysSince: null,
      thisWeek: 0,
      owed: false,
      reasons: [],
      drafts: [
        {
          label: "Pre-launch check-in",
          en: `Hi ${profile.client_name}, your brand direction and offer are locked in on our side. We are producing the first set of ads now.`,
          ar: `هلا ${profile.client_name}، اتجاه الهوية والعرض مثبتين عندنا. الحين نجهز أول مجموعة إعلانات.`,
        },
      ],
    },
    serviceLine: profile.service || campaigns[0]?.service_type || null,
    campaigns: campaigns.map(k => ({
      campaignName: k.campaign_name,
      serviceType: k.service_type,
      spend7d: Number(k.spend_7d || 0),
      leads7d: Number(k.leads_7d || 0),
      bookings7d: Number(k.bookings_7d || 0),
      costPerBooking: Number(k.cost_per_booking || 0),
      boardAdStatus: "ACTIVE",
    })),
    liveNow: mappedAds.slice(0, 10).map(a => ({
      metaId: a.metaAdId,
      name: a.adName,
      campaignName: a.campaignName,
      accountId: undefined,
      thumbUrl: a.thumbnailUrl,
      stillKey: a.stillKey,
      stillUrl: a.stillUrl,
      stillTinyUrl: a.stillTinyUrl,
    })),
    history: mappedAds.sort((a, b) => b.spend - a.spend),
  };
}

export async function fetchContextPack(
  client: SupabaseClient,
  clientName: string,
): Promise<{ markdown: string; counts: { campaigns: number; ads: number; transcripts: number; funnels: number; plays: number; tasks: number; videos: number } }> {
  const detail = await fetchClientDetail(client, clientName);
  if (!detail) {
    return {
      markdown: `# ${clientName}\n\nClient not found.`,
      counts: { campaigns: 0, ads: 0, transcripts: 0, funnels: 0, plays: 0, tasks: 0, videos: 0 },
    };
  }

  const lines = [
    `# Context Pack: ${detail.client.name}`,
    `Service: ${detail.serviceLine ?? "Unknown"}`,
    `Status: ${detail.client.clientStatus}`,
    "",
    "## Brand Direction & Notes",
    detail.client.docs.brandDna ? `- Brand DNA: ${detail.client.docs.brandDna}` : "",
    detail.client.docs.offerCheatSheet ? `- Offer Cheat Sheet: ${detail.client.docs.offerCheatSheet}` : "",
    "",
    "## Campaigns",
    ...detail.campaigns.map((c: Any) => `- ${c.campaignName}: $${c.spend7d} spend, ${c.leads7d} leads`),
    "",
    "## Top Winning Ads",
    ...detail.history.slice(0, 5).map((a: Any) => `- ${a.adName}: $${a.spend} spend, ${a.leads} leads ($${a.cpl} CPL)`),
  ].filter(Boolean);

  return {
    markdown: lines.join("\n"),
    counts: {
      campaigns: detail.campaigns.length,
      ads: detail.history.length,
      transcripts: 0,
      funnels: 0,
      plays: 0,
      tasks: detail.tasks.length,
      videos: detail.videos.length,
    },
  };
}

export async function queueClientAction(
  client: SupabaseClient,
  args: { client: string; action: string; payload?: Any },
): Promise<void> {
  await client.from("cockpit_decisions").insert({
    subject: args.client,
    action: args.action,
    evidence: JSON.stringify(args.payload ?? {}),
    kind: "client_action",
    day: new Date().toISOString().slice(0, 10),
  });
}

export async function fetchClientOutbox(
  client: SupabaseClient,
): Promise<Any[]> {
  const { data } = await client
    .from("cockpit_decisions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []).map(d => ({
    _id: String(d.id),
    id: d.id,
    action: d.action,
    client: d.subject,
    payload: d.evidence,
    createdAt: d.created_at ? new Date(d.created_at).getTime() : Date.now(),
  }));
}

export async function logClientTouch(
  client: SupabaseClient,
  args: { client?: string; clientName?: string; action?: string; note?: string; kind?: string },
): Promise<void> {
  const name = args.client || args.clientName || "Client";
  await client.from("cockpit_decisions").insert({
    subject: name,
    action: args.action || "log_touch",
    evidence: args.note || "",
    kind: args.kind || "touchpoint",
    day: new Date().toISOString().slice(0, 10),
  });
}

export async function fetchFunnels(
  client: SupabaseClient,
  clientName?: string,
): Promise<{ rows: Any[]; counts: { destinations: number; accounts: number; forms: number; noGate: number } }> {
  let query = client.from("cockpit_ads").select("*");
  const { data: ads } = await query;

  const rows: Any[] = [];
  const groups = new Map<string, Any>();

  for (const a of ads ?? []) {
    const camp = a.campaign_name || "General Campaign";
    if (clientName && !camp.toLowerCase().includes(clientName.toLowerCase())) {
      continue;
    }
    const g = groups.get(camp) ?? {
      account: camp,
      kind: "Instant form",
      url: undefined,
      formName: a.ad_name,
      headline: a.ad_name,
      questions: [],
      gates: 0,
      spend: 0,
      leads: 0,
      cpl: 0,
      ads: [],
    };
    g.spend += Number(a.spend || 0);
    g.leads += Number(a.leads || 0);
    g.ads.push({ adId: a.meta_ad_id || String(a.id), adName: a.ad_name, status: "ACTIVE" });
    groups.set(camp, g);
  }

  for (const g of groups.values()) {
    g.cpl = g.leads > 0 ? Number((g.spend / g.leads).toFixed(2)) : 0;
    rows.push(g);
  }

  return {
    rows,
    counts: {
      destinations: rows.length,
      accounts: rows.length,
      forms: rows.length,
      noGate: rows.length,
    },
  };
}

export async function fetchScriptsList(
  client: SupabaseClient,
  opts?: number | { limit?: number },
): Promise<{ rows: Any[]; clients: string[] }> {
  const limit = typeof opts === "number" ? opts : (opts?.limit ?? 300);
  const { data: planItems } = await client
    .from("cockpit_plan_items")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows = (planItems ?? []).map(p => ({
    taskId: String(p.id),
    name: p.text || "Script",
    url: undefined,
    status: p.status || "complete",
    client: p.client_name || null,
    otherClients: [],
    assignees: [],
    dueDate: p.due_date ? new Date(p.due_date).getTime() : null,
    createdAt: p.created_at ? new Date(p.created_at).getTime() : Date.now(),
    updatedAt: p.created_at ? new Date(p.created_at).getTime() : Date.now(),
    script: p.text || "",
    drive: null,
  }));

  const clientSet = new Set<string>();
  for (const r of rows) {
    if (r.client) clientSet.add(r.client);
  }

  return {
    rows,
    clients: [...clientSet].sort(),
  };
}

export async function fetchScriptQueue(
  client: SupabaseClient,
  allowedClients?: string[] | null,
): Promise<Any> {
  const roster = await fetchClientRoster(client, allowedClients);
  return {
    queue: roster.clients.slice(0, 10).map(c => ({
      client: c.name,
      type: "new_angle",
      why: `${c.name} has ${c.openScripts} open scripts and ${c.liveCampaigns} active campaigns`,
      serviceLine: c.service || "General",
      urgency: c.prelaunch ? "high" : "normal",
    })),
    counts: {
      queue: roster.clients.length,
      urgent: roster.toContact.length,
    },
  };
}

export async function fetchCalendar(
  client: SupabaseClient,
  allowedClients?: string[] | null,
): Promise<Any> {
  const roster = await fetchClientRoster(client, allowedClients);
  const items = roster.clients.map(c => ({
    id: c.taskId,
    day: new Date().toISOString().slice(0, 10),
    client: c.name,
    kind: "script" as const,
    title: `Script for ${c.name}`,
    status: c.clientStatus,
    open: true,
    overdue: c.prelaunch,
    canSchedule: true,
    canComplete: true,
  }));

  return {
    items,
    counts: {
      total: items.length,
      overdue: items.filter(i => i.overdue).length,
    },
  };
}
