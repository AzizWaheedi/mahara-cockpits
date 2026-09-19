import "@/components/ceo/ceo.css";
import { useQuery } from "convex/react";
import { LoaderCircle, ShieldOff } from "lucide-react";
import {
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type CeoTab,
  CeoTabs,
  panelId,
  tabId,
  useTabParam,
} from "@/components/ceo/CeoTabs";
import { EmptyState } from "@/components/ceo/EmptyState";
import { kuwaitDay, longDate } from "@/components/ceo/format";
import { highRiskCount } from "@/components/ceo/metrics";
import { RefreshButton } from "@/components/ceo/RefreshButton";
import { TrustPills } from "@/components/ceo/TrustPills";
import {
  type CeoSections,
  trustSummary,
  useCeo,
  useNow,
} from "@/components/ceo/useCeo";
import { api } from "../../convex/_generated/api";
import { AdsTab } from "./ceo/AdsTab";
import { BackendTab } from "./ceo/BackendTab";
import { CallsTab } from "./ceo/CallsTab";
import { ClientSuccessTab } from "./ceo/ClientSuccessTab";
import { DeliveryTab } from "./ceo/DeliveryTab";
import { FrontendTab } from "./ceo/FrontendTab";
import { MachineTab } from "./ceo/MachineTab";
import { ManagementTab } from "./ceo/ManagementTab";
import { MarketingTab } from "./ceo/MarketingTab";
import { MoneyTab } from "./ceo/MoneyTab";
import { OrganicTab } from "./ceo/OrganicTab";
import { SalesTab } from "./ceo/SalesTab";
import { statusSentence } from "./ceo/statusSentence";
import { TodayTab } from "./ceo/TodayTab";
import { CEO_TAB_KEYS, type CeoTabKey, type CeoTabProps } from "./ceo/types";

const TAB_LABELS: Record<CeoTabKey, string> = {
  today: "Today",
  frontend: "Frontend",
  marketing: "Marketing",
  ads: "Ads",
  organic: "Organic",
  sales: "Sales",
  backend: "Backend",
  delivery: "Delivery",
  calls: "Calls",
  "client-success": "Client success",
  management: "Management",
  money: "Money",
  machine: "Machine",
};

const TAB_VIEWS: Record<CeoTabKey, (props: CeoTabProps) => ReactNode> = {
  today: TodayTab,
  frontend: FrontendTab,
  marketing: MarketingTab,
  ads: AdsTab,
  organic: OrganicTab,
  sales: SalesTab,
  backend: BackendTab,
  delivery: DeliveryTab,
  calls: CallsTab,
  "client-success": ClientSuccessTab,
  management: ManagementTab,
  money: MoneyTab,
  machine: MachineTab,
};

function tabsFor(sections: CeoSections): CeoTab<CeoTabKey>[] {
  const clients = sections.clients?.payload;
  const highRisk = clients ? highRiskCount(clients) : null;
  const machine = sections.machine?.payload;
  const failing = machine ? machine.failingJobs + machine.failingSources : null;
  return CEO_TAB_KEYS.map(key => ({
    key,
    label: TAB_LABELS[key],
    count:
      key === "client-success"
        ? highRisk
        : key === "machine"
          ? failing
          : undefined,
    countTone:
      key === "client-success"
        ? "serious"
        : key === "machine"
          ? "critical"
          : undefined,
  }));
}

/**
 * On phones the title block scrolls away and only the tabs stay pinned; from
 * the sm breakpoint up the whole header stays. Done with one sticky element
 * whose top is minus the title block's height on narrow screens.
 */
function useStickyTop() {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setTop(mq.matches ? -el.offsetHeight : 0);
    update();
    const ro =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(el);
    mq.addEventListener("change", update);
    return () => {
      ro?.disconnect();
      mq.removeEventListener("change", update);
    };
  }, []);
  return [ref, top] as const;
}

/** The founder's command center at /ceo: one header, eleven tabs, every number with its trust. */
export function CeoPage() {
  const me = useQuery(api.roles.me, {});
  const isCeo = me?.isCeo === true;
  const { sections, day, loading } = useCeo(isCeo);
  const now = useNow();
  const [tab, setTab] = useTabParam(CEO_TAB_KEYS, "today");
  const [headerRef, stickyTop] = useStickyTop();

  const trust = useMemo(() => trustSummary(sections, now), [sections, now]);
  const tabs = useMemo(() => tabsFor(sections), [sections]);
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
      <div
        className="sticky z-30 -mx-4 bg-background/90 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-background/75 lg:-mx-6 lg:px-6"
        style={{ top: stickyTop }}
      >
        <div
          ref={headerRef}
          className="flex flex-col gap-4 pb-4 pt-1 md:flex-row md:items-end md:justify-between"
        >
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              CEO
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              {longDate(day ?? kuwaitDay(now))}
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
        <div className="border-b">
          <CeoTabs tabs={tabs} value={tab} onChange={setTab} />
        </div>
      </div>

      <div
        role="tabpanel"
        id={panelId(tab)}
        aria-labelledby={tabId(tab)}
        className="min-w-0 pb-10 pt-6"
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
