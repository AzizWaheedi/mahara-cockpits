import {
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Globe,
  Instagram,
  Megaphone,
  MessageCircle,
} from "lucide-react";
import { count, money, pct } from "@/components/ceo/format";
import { costText, cplTone } from "@/lib/costTone";
import {
  alsoRuns,
  type CampaignFunnel,
  type FunnelKind,
  type FunnelLine,
  funnelName,
} from "@/lib/funnelSplit";
import { cn } from "@/lib/utils";

const ICON: Record<FunnelKind, typeof Globe> = {
  form: ClipboardList,
  website: Globe,
  whatsapp: MessageCircle,
  messenger: MessageCircle,
  instagram: Instagram,
  chat: MessageCircle,
  other: Megaphone,
  unknown: CircleHelp,
};

const usd2 = (n: number | undefined) =>
  n === undefined ? "n/a" : `$${n.toFixed(2)}`;

/**
 * The client's numbers by funnel, under the totals: one row per funnel with
 * its spend, leads, cost per lead and share of the spend (Muhammed,
 * 2026-10-26: say whether the numbers come from the instant form or the lead
 * page). A campaign counts whole under the funnel it spent most on.
 */
export function FunnelSplit({
  lines,
  loading,
  error,
  onLeadPage,
}: {
  lines: FunnelLine[];
  loading: boolean;
  error: string | null;
  /** Scrolls to the Lead page part; given only when the client has one. */
  onLeadPage?: () => void;
}) {
  return (
    <div className="mt-5 border-t pt-4">
      <p className="text-sm font-medium">By funnel</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Where the ads send people, read from Meta's ad sets. Each campaign
        counts under the funnel it spent most on.
      </p>
      {error ? (
        <p className="mt-3 text-xs text-muted-foreground">
          The funnels could not be read: {error}. The totals above are not
          affected.
        </p>
      ) : loading ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Reading each campaign's funnel…
        </p>
      ) : lines.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          No campaign spent or brought a lead in this range.
        </p>
      ) : (
        <ul className="mt-3 space-y-3" aria-label="Spend and leads by funnel">
          {lines.map(l => {
            const Icon = ICON[l.kind];
            const tone = cplTone(l.cpl);
            return (
              <li key={l.kind} className="space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
                  <span className="flex min-w-0 items-center gap-2 font-medium">
                    <Icon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="truncate">{l.name}</span>
                    {l.kind === "website" && onLeadPage && (
                      <button
                        type="button"
                        onClick={onLeadPage}
                        className="no-touch inline-flex items-center gap-0.5 text-xs font-normal text-primary hover:underline"
                      >
                        Where visitors stop
                        <ChevronRight className="size-3.5" aria-hidden />
                      </button>
                    )}
                  </span>
                  <span className="flex shrink-0 items-baseline gap-4 whitespace-nowrap tabular-nums">
                    <span>{money(l.spend)}</span>
                    <span className="text-muted-foreground">
                      {count(l.leads)} {l.leads === 1 ? "lead" : "leads"}
                    </span>
                    <span className={cn("w-24 text-right", costText(tone))}>
                      {usd2(l.cpl)}
                      <span className="ml-1 text-xs text-muted-foreground">
                        a lead
                      </span>
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/80"
                      style={{ width: `${Math.round(l.share * 100)}%` }}
                    />
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-right text-[11px] text-muted-foreground tabular-nums">
                    {pct(l.share)} of spend · {l.campaigns.length}{" "}
                    {l.campaigns.length === 1 ? "campaign" : "campaigns"}
                  </span>
                </div>
                {l.mixed.length > 0 && (
                  <p className="text-[11px] text-muted-foreground" dir="auto">
                    {l.mixed.join(", ")}{" "}
                    {l.mixed.length === 1 ? "also spends" : "also spend"} on
                    another funnel;{" "}
                    {l.mixed.length === 1 ? "it counts" : "they count"} here
                    whole.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A campaign's funnel, before its numbers in the Campaigns list. */
export function FunnelTag({
  funnel,
  hasLeadPage,
}: {
  funnel: CampaignFunnel | undefined;
  hasLeadPage: boolean;
}) {
  if (!funnel) return null;
  const Icon = ICON[funnel.kind];
  const also = alsoRuns(funnel).map(k => funnelName(k, hasLeadPage));
  return (
    <span className="mr-1.5 inline-flex items-center gap-1 align-[-2px] font-medium text-foreground/80">
      <Icon className="size-3.5" aria-hidden />
      {[funnelName(funnel.kind, hasLeadPage), ...also].join(" + ")}
    </span>
  );
}
