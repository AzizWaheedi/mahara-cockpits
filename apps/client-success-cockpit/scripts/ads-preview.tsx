/**
 * Local-only visual check for the Results tab's ads and the folding rail.
 * Fictional client, fictional numbers, no database read. Open
 * /scripts/ads-preview.html on the dev server. Switches: ?period=7d|30d|all,
 * ?dwy=1, ?bookings=0.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { AppLayout } from "../src/components/AppLayout";
import { AdsView } from "../src/components/ClientAds";
import { ThemeProvider } from "../src/contexts/ThemeContext";
import { buildAdsModel, type ClientAdsRead } from "../src/lib/clientAds";
import { shiftDay } from "../src/lib/reportPeriod";
import "../src/index.css";

const q = new URLSearchParams(location.search);
// ?rail=folded opens with the rail folded to its icons, as a returning user would.
try {
  localStorage.setItem(
    "mahara-csm-sidebar",
    q.get("rail") === "folded" ? "collapsed" : "expanded",
  );
} catch {
  /* Storage may be disabled. */
}
const TODAY = "2026-10-12";
const LAST = "2026-10-11";
const FIRST = "2026-08-13";
const rnd = (seed: string) => {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000;
};
const pic = (a: string, b: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="96" height="96" fill="url(#g)"/><circle cx="66" cy="34" r="14" fill="#fff" fill-opacity=".35"/><rect x="14" y="60" width="54" height="10" rx="5" fill="#fff" fill-opacity=".5"/></svg>`,
  )}`;

type Ad = {
  id: string;
  name: string;
  set: string;
  camp: string;
  from: string;
  to?: string;
  cpl: number;
  w: number;
  picture?: string;
  status?: string;
};
const LIVE = "EXAMPLE-MAHARA-6\\10";
const OLD = "EXAMPLE-MAHARA-9\\9";
const ADS: Ad[] = [
  {
    id: "71001",
    name: "Ad-1 | Villa gates video",
    set: "Leads | 30d | Kuwait",
    camp: LIVE,
    from: "2026-10-06",
    cpl: 9,
    w: 3,
    picture: pic("#1d3a8f", "#00cfc8"),
    status: "ACTIVE",
  },
  {
    id: "71002",
    name: "Ad-2 | Before and after carousel",
    set: "Leads | 30d | Kuwait",
    camp: LIVE,
    from: "2026-10-06",
    cpl: 16,
    w: 2,
    picture: pic("#2e5bd6", "#0f1b45"),
    status: "ACTIVE",
  },
  {
    id: "71003",
    name: "Ad-3 | Testimonial",
    set: "Leads | 30d | Kuwait",
    camp: LIVE,
    from: "2026-10-08",
    to: "2026-10-09",
    cpl: 40,
    w: 1,
    picture: pic("#091333", "#2e5bd6"),
    status: "PAUSED",
  },
  {
    id: "71004",
    name: "Ad-4 | Arabic hook test",
    set: "Leads | 30d | Riyadh",
    camp: LIVE,
    from: "2026-10-07",
    cpl: 12,
    w: 2,
    status: "ACTIVE",
  },
  {
    id: "71005",
    name: "Ad-5 | Showroom tour",
    set: "Leads | 30d | Riyadh",
    camp: LIVE,
    from: "2026-10-12",
    cpl: 12,
    w: 1,
    picture: pic("#00a9a3", "#1d3a8f"),
    status: "ACTIVE",
  },
  {
    id: "70001",
    name: "ad-1 | Gates still",
    set: "Leads|30d| Instant form",
    camp: OLD,
    from: "2026-09-09",
    to: "2026-10-03",
    cpl: 14,
    w: 3,
    picture: pic("#1d3a8f", "#2e5bd6"),
  },
  {
    id: "70002",
    name: "ad-2 | Metalwork reel",
    set: "Leads|30d| Instant form",
    camp: OLD,
    from: "2026-09-09",
    to: "2026-09-25",
    cpl: 22,
    w: 2,
    picture: pic("#0f1b45", "#00cfc8"),
  },
  {
    id: "70003",
    name: "ad-3 | Offer static",
    set: "Leads|30d| Instant form",
    camp: OLD,
    from: "2026-09-12",
    to: "2026-10-03",
    cpl: 11,
    w: 2,
    picture: pic("#2e5bd6", "#00cfc8"),
  },
];

const all: ClientAdsRead["rows"] = [];
for (let d = FIRST; d <= LAST; d = shiftDay(d, 1))
  for (const a of ADS) {
    if (d < a.from || (a.to && d > a.to)) continue;
    const spend = Math.round(a.w * 9 * (0.7 + 0.6 * rnd(a.id + d)) * 100) / 100;
    const leads = Math.round(
      (spend / a.cpl) * (0.6 + 0.8 * rnd(`l${a.id}${d}`)),
    );
    const impressions = Math.round(
      spend * 110 * (0.9 + 0.2 * rnd(`i${a.id}${d}`)),
    );
    all.push({
      date: d,
      campaignName: a.camp,
      adSetName: a.set,
      adName: a.name,
      adId: a.id,
      spend,
      leads,
      impressions,
      linkClicks: Math.round(impressions * 0.011),
      frequency: 1 + rnd(`f${a.id}${d}`),
    });
  }
const period =
  q.get("period") === "7d"
    ? { from: shiftDay(TODAY, -6), to: TODAY, label: "last 7 days" }
    : q.get("period") === "all"
      ? { from: "2026-08-01", to: TODAY, label: "all time" }
      : { from: shiftDay(TODAY, -29), to: TODAY, label: "last 30 days" };
const start = period.from < FIRST ? FIRST : period.from;
const bookings: NonNullable<ClientAdsRead["bookings"]> = [];
for (const r of all)
  if (r.leads && rnd(`b${r.adId}${r.date}`) < 0.35)
    bookings.push({
      date: r.date,
      campaignName: r.campaignName,
      adId: rnd(`u${r.date}`) < 0.15 ? undefined : r.adId,
      status:
        rnd(`s${r.date}`) < 0.5
          ? "showed"
          : rnd(`n${r.date}`) < 0.5
            ? "noshow"
            : "confirmed",
      startTime: `${shiftDay(r.date, 2)}T10:00:00Z`,
      appointmentDate: shiftDay(r.date, 2),
    });

const change = (
  day: string,
  at: number,
  kind: string,
  action: string,
  subject: string,
  actor?: string,
) => ({
  day,
  at,
  kind,
  action,
  actor,
  source: "meta_activity",
  subject,
  evidence: undefined,
  link: undefined,
});

const read: ClientAdsRead = {
  clientName: "Example Design",
  start,
  end: LAST,
  statsAt: "2026-10-12T05:00:00Z",
  bookingsReady: q.get("bookings") !== "0",
  coverage: { first: "2026-09-09", last: LAST },
  feedFirst: FIRST,
  campaigns: [
    {
      name: LIVE,
      metaCampaignId: "52561527770966",
      accountId: "2140901837311419",
      accountName: "example add",
      currency: "USD",
      budgetDaily: 40,
      budgetLevel: "campaign",
      ended: false,
    },
    {
      name: OLD,
      metaCampaignId: "52555407180766",
      accountId: "2140901837311419",
      accountName: "example add",
      currency: "USD",
      budgetDaily: 40,
      budgetLevel: "campaign",
      ended: true,
    },
  ],
  adsets: [
    {
      id: "52561527770001",
      name: "Leads | 30d | Kuwait",
      campaignName: LIVE,
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
    },
    {
      id: "52561527770002",
      name: "Leads | 30d | Riyadh",
      campaignName: LIVE,
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
    },
  ],
  ads: ADS.filter(a => a.camp === LIVE).map(a => ({
    id: a.id,
    name: a.name,
    adsetId: a.set.includes("Kuwait") ? "52561527770001" : "52561527770002",
    campaignName: a.camp,
    status: a.status,
    effectiveStatus: a.status,
    accountId: "2140901837311419",
    creativeId: undefined,
    thumbUrl: undefined,
  })),
  rows: all.filter(r => r.date >= start),
  history: all.filter(r => r.date < start && r.date >= shiftDay(start, -30)),
  bookings: bookings.filter(b => b.date >= start),
  verdicts: [
    {
      adId: "71001",
      adName: "Ad-1",
      campaignName: LIVE,
      verdict: "scale",
      reason: "CPL $9.10 is under the $15 gate on $226 spend.",
    },
    {
      adId: "71002",
      adName: "Ad-2",
      campaignName: LIVE,
      verdict: "hold",
      reason:
        "CPL $15.38 is over the $15 gate but within 50% — watch, do not scale.",
    },
    {
      adId: "71003",
      adName: "Ad-3",
      campaignName: LIVE,
      verdict: "kill",
      reason: "$40 spent, one lead in 7 days.",
    },
  ],
  stills: {},
  changes: [
    change("2026-10-06", 1, "create_campaign_group", "Campaign created", LIVE),
    change(
      "2026-10-07",
      2,
      "update_campaign_budget",
      "Campaign budget updated",
      LIVE,
      "Hasan",
    ),
    change(
      "2026-10-09",
      3,
      "update_ad_run_status",
      "Ad status updated",
      "Ad-3 | Testimonial",
    ),
    change(
      "2026-09-25",
      4,
      "update_ad_run_status",
      "Ad status updated",
      "ad-2 | Metalwork reel",
    ),
    change(
      "2026-09-20",
      5,
      "update_campaign_budget_scheduling_state",
      "Ad set budget scheduling enabled",
      "Leads|30d| Instant form",
    ),
    change("2026-09-28", 6, "edit_images", "Images edited", "example add"),
  ],
};
const model = buildAdsModel(read, period, Date.parse("2026-10-12T09:00:00Z"));
// The fixture's pictures stand in for saved stills; Ad-4 has none, so its
// row shows the placeholder after the live preview is refused (no sign-in here).
for (const ad of model.campaigns.flatMap(c => c.sets.flatMap(s => s.ads))) {
  const src = ADS.find(a => a.id === ad.id);
  if (src?.picture) ad.stillTinyUrl = src.picture;
}

function Page() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          Clients / Example Design · Local preview, fictional numbers
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Example Design
        </h1>
      </div>
      <section className="space-y-3">
        <h3 className="text-[15px] font-semibold">Ads, {period.label}</h3>
        <AdsView
          model={model}
          clientName="Example Design"
          per={period}
          dwy={q.get("dwy") === "1"}
        />
      </section>
    </div>
  );
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <React.StrictMode>
      <ThemeProvider
        defaultTheme={q.get("theme") === "light" ? "light" : "dark"}
      >
        <MemoryRouter initialEntries={["/clients/example"]}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="*" element={<Page />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </React.StrictMode>,
  );
