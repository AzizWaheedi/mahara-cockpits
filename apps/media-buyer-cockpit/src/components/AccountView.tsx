import { LostLeads } from "@/components/LostLeads";
import { StatusToggle } from "@/components/StatusToggle";
import { Button } from "@/components/ui/button";

/**
 * Everything for one client on a single screen.
 *
 * The campaign table answers "what needs me today" across 40 accounts. This
 * answers the other question, "show me this client", without her hunting
 * through rows. Deliberately plain: totals, the campaigns, why leads died.
 */
// biome-ignore lint/suspicious/noExplicitAny: snapshot rows are untyped
type Row = any;

const money = (n?: number, dp = 0) =>
  n === undefined || n === null
    ? "n/a"
    : `$${n.toLocaleString("en-US", {
        minimumFractionDigits: dp,
        maximumFractionDigits: dp,
      })}`;

export function AccountView({
  client,
  campaigns,
  tree,
  onClose,
  onOpenCampaign,
}: {
  client: string;
  campaigns: Row[];
  tree: Row[];
  onClose: () => void;
  onOpenCampaign: (campaignName: string) => void;
}) {
  const spend = campaigns.reduce((t, c) => t + (c.spend7d ?? 0), 0);
  const leads = campaigns.reduce((t, c) => t + (c.leads7d ?? 0), 0);
  // The sync writes the 7-day count as bookings7d, the same field the table reads.
  const booked = campaigns.reduce((t, c) => t + (c.bookings7d ?? 0), 0);
  const cpl = leads > 0 ? spend / leads : undefined;
  const cpb = booked > 0 ? spend / booked : undefined;
  // Bookings come from one GHL call per client, so any campaign carries them.
  const lost = campaigns.find(c => c.lost)?.lost;
  // Campaign rows carry no status of their own; an ad that is delivering
  // (effective status, which folds in the parent's) means the campaign is on.
  const isLive = (c: Row) =>
    tree.some(
      t =>
        t.campaignName === c.campaignName &&
        t.kind === "ad" &&
        (t.effectiveStatus ?? t.status) === "ACTIVE",
    );
  const live = campaigns.filter(isLive).length;

  return (
    <div className="rounded-2xl border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold" dir="auto">
            {client}
          </h2>
          <div className="mt-1 text-sm text-muted-foreground">
            {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"} ·{" "}
            {live} live · last 7 days
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={onClose}>
          Back to all accounts
        </Button>
      </div>

      <div className="@container mt-4">
        <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-5">
          {[
            ["Spend", money(spend)],
            ["Leads", String(leads)],
            ["Cost per lead", money(cpl, 2)],
            ["Booked", String(booked)],
            ["Cost per booking", money(cpb, 2)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-muted/40 p-3">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="mt-0.5 whitespace-nowrap text-lg font-semibold tabular-nums tracking-tight">
                {value}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 divide-y">
        {campaigns.map(c => (
          <div
            key={c._id}
            className="flex flex-wrap items-center justify-between gap-2 py-3"
          >
            <div className="min-w-0">
              <button
                type="button"
                className="text-left text-sm font-semibold hover:underline"
                onClick={() => onOpenCampaign(c.campaignName)}
              >
                {c.campaignName}
              </button>
              <div className="text-xs text-muted-foreground">
                {money(c.spend7d)} · {c.leads7d ?? 0} leads · {money(c.cpl, 2)}{" "}
                per lead
                {c.daysLive !== undefined ? ` · live ${c.daysLive}d` : ""}
              </div>
            </div>
            <StatusToggle
              compact
              metaId={c.metaCampaignId}
              level="campaign"
              name={c.campaignName}
              clientTag={c.clientTag}
              campaignName={c.campaignName}
              active={isLive(c)}
            />
          </div>
        ))}
      </div>

      <LostLeads
        lost={lost}
        adNameById={Object.fromEntries(
          tree
            .filter(t => t.kind === "ad" && t.metaId)
            .map(t => [t.metaId, t.name]),
        )}
      />
    </div>
  );
}
