import "@/components/ceo/ceo.css";
import { useQuery } from "convex/react";
import { LoaderCircle, ShieldOff } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { panelId, tabId, useTabParam } from "@/components/ceo/CeoTabs";
import { EmptyState } from "@/components/ceo/EmptyState";
import { kuwaitDay, longDate } from "@/components/ceo/format";
import { highRiskCount } from "@/components/ceo/metrics";
import { RefreshButton } from "@/components/ceo/RefreshButton";
import { TrustPills } from "@/components/ceo/TrustPills";
import type { CeoSections } from "@/components/ceo/useCeo";
import { trustSummary, useCeo, useNow } from "@/components/ceo/useCeo";
import { api } from "../../convex/_generated/api";
import { AdsTab } from "./ceo/AdsTab";
import { BackendTab } from "./ceo/BackendTab";
import { BillingTab } from "./ceo/BillingTab";
import { CallsTab } from "./ceo/CallsTab";
import { ClientSuccessTab } from "./ceo/ClientSuccessTab";
import { DeliveryTab } from "./ceo/DeliveryTab";
import { FrontendTab } from "./ceo/FrontendTab";
import { GoalsTab } from "./ceo/GoalsTab";
import { HiringTab } from "./ceo/HiringTab";
import { IdeationTab } from "./ceo/IdeationTab";
import { MachineTab } from "./ceo/MachineTab";
import { ManagementTab } from "./ceo/ManagementTab";
import { MarketingTab } from "./ceo/MarketingTab";
import { MoneyTab } from "./ceo/MoneyTab";
import { CEO_LABELS } from "./ceo/nav";
import { OrganicTab } from "./ceo/OrganicTab";
import { PostingTab } from "./ceo/PostingTab";
import { SalesTab } from "./ceo/SalesTab";
import { statusSentence } from "./ceo/statusSentence";
import { TeamTab } from "./ceo/TeamTab";
import { TodayTab } from "./ceo/TodayTab";
import { TransactionsTab } from "./ceo/TransactionsTab";
import { CEO_TAB_KEYS, type CeoTabKey, type CeoTabProps } from "./ceo/types";

const TAB_VIEWS: Record<CeoTabKey, (props: CeoTabProps) => ReactNode> = {
  today: TodayTab,
  goals: GoalsTab,
  frontend: FrontendTab,
  marketing: MarketingTab,
  ads: AdsTab,
  organic: OrganicTab,
  ideation: IdeationTab,
  posting: PostingTab,
  sales: SalesTab,
  backend: BackendTab,
  delivery: DeliveryTab,
  calls: CallsTab,
  "client-success": ClientSuccessTab,
  management: ManagementTab,
  team: TeamTab,
  hiring: HiringTab,
  money: MoneyTab,
  billing: BillingTab,
  transactions: TransactionsTab,
  machine: MachineTab,
};

/** Counts that ride the section names in the rail: risk on client success, failures on machine. */
export function ceoBadges(
  sections: CeoSections,
): Partial<Record<CeoTabKey, { count: number; tone: "serious" | "critical" }>> {
  const clients = sections.clients?.payload;
  const machine = sections.machine?.payload;
  const out: Partial<
    Record<CeoTabKey, { count: number; tone: "serious" | "critical" }>
  > = {};
  const risk = clients ? highRiskCount(clients) : 0;
  if (risk) out["client-success"] = { count: risk, tone: "serious" };
  const failing = machine ? machine.failingJobs + machine.failingSources : 0;
  if (failing) out.machine = { count: failing, tone: "critical" };
  return out;
}

/**
 * The founder's command centre at /ceo. The sections live in the left rail
 * (AppSidebar renders them when the path is /ceo); this page is the header
 * and the one section on screen.
 */
export function CeoPage() {
  const me = useQuery(api.roles.me, {});
  const isCeo = me?.isCeo === true;
  const { sections, day, loading } = useCeo(isCeo);
  const now = useNow();
  const [tab, setTab] = useTabParam(CEO_TAB_KEYS, "today");

  const trust = useMemo(() => trustSummary(sections, now), [sections, now]);
  const sentence = useMemo(() => statusSentence(sections), [sections]);

  if (me && !me.isCeo)
    return (
      <div className="mx-auto max-w-md py-16">
        <EmptyState
          icon={ShieldOff}
          title="The CEO cockpit is Aziz's only"
          text="Ask Aziz if you need a number from here."
        />
      </div>
    );

  const View = TAB_VIEWS[tab];
  const ready = me !== undefined && !loading;

  return (
    <div className="ceo-root mx-auto w-full min-w-0 max-w-[1440px]">
      <div className="flex flex-col gap-3 pb-5 pt-1 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            {longDate(day ?? kuwaitDay(now))}
          </p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-foreground">
            {CEO_LABELS[tab]}
          </h1>
          <p className="mt-1 min-h-5 text-sm text-muted-foreground">
            {ready ? sentence : "Loading the numbers."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          {ready ? (
            <TrustPills
              // contents: the pills and the Refresh button wrap as one row on a phone.
              className="contents"
              asOf={trust.asOf}
              now={now}
              stale={trust.stale}
              missing={trust.missing.length}
              hermes={trust.hermes}
              onOpenMachine={() => setTab("machine")}
            />
          ) : null}
          {isCeo ? <RefreshButton /> : null}
        </div>
      </div>

      <div
        role="tabpanel"
        id={panelId(tab)}
        aria-labelledby={tabId(tab)}
        className="min-w-0 pb-10"
      >
        {ready ? (
          <View sections={sections} now={now} day={day} goTab={setTab} />
        ) : (
          <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
            <LoaderCircle
              className="ceo-spin size-4 animate-spin text-[color:var(--ceo-emphasis)]"
              aria-hidden
            />
            Loading the cockpit
          </div>
        )}
      </div>
    </div>
  );
}
