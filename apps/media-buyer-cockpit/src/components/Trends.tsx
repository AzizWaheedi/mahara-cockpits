import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { TrendChart } from "./TrendChart";

// biome-ignore lint/suspicious/noExplicitAny: series rows
type Any = any;

/** Start of day: the whole book, last 30 days, one small chart per number. */
export function PortfolioTrends() {
  const rows = useQuery(api.stats.portfolioTrend, {}) as Any[] | undefined;
  if (!rows) return null;
  const pts = (k: string) => rows.map(r => ({ x: r.date, y: r[k] ?? null }));
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <h2 className="mb-2 text-[12px] font-bold uppercase tracking-widest text-teal-600">
        Trends, last 30 days
      </h2>
      <div className="grid gap-3 md:grid-cols-3">
        <TrendChart title="Leads per day" points={pts("leads")} kind="bar" />
        <TrendChart title="Spend per day" points={pts("spend")} unit="$" />
        <TrendChart
          title="Cost per lead"
          points={pts("cpl")}
          unit="$"
          mode="avg"
          goodWhen="down"
        />
      </div>
    </section>
  );
}

/** One campaign over the picked range. */
export function CampaignTrend({
  campaignName,
  start,
  end,
}: {
  campaignName: string;
  start: string;
  end: string;
}) {
  const rows = useQuery(api.stats.campaignTrend, {
    campaignName,
    start,
    end,
  }) as Any[] | undefined;
  if (!rows || rows.length < 2) return null;
  const pts = (k: string) => rows.map(r => ({ x: r.date, y: r[k] ?? null }));
  return (
    <div className="mb-3 grid gap-3 md:grid-cols-3">
      <TrendChart title="Leads per day" points={pts("leads")} kind="bar" />
      <TrendChart title="Spend per day" points={pts("spend")} unit="$" />
      <TrendChart
        title="Cost per lead"
        points={pts("cpl")}
        unit="$"
        mode="avg"
        goodWhen="down"
      />
    </div>
  );
}
