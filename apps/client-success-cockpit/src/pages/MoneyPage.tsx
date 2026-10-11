import { useSearchParams } from "react-router";
import { PageHeader, Pill, PillRow } from "@/components/kit";
import { BillingPage } from "./BillingPage";
import { ChurnPage } from "./ChurnPage";
import { HotListPage, MyMoneyPage } from "./CsmPage";
import { InvoicesPage } from "./InvoicesPage";
import { ProjectionsPage } from "./ProjectionsPage";

/**
 * Money: billing, the hot list, projections, churn, the CSM's own pay and
 * invoices, as tabs of one place (they were five pages in two sidebar groups;
 * invoices joined on 11 Oct 2026).
 * Each tab is the page it was, unchanged underneath; the old addresses
 * (/billing, /projections, /churn, /hotlist) land on their tab.
 */
const TABS = [
  { key: "billing", label: "Billing" },
  { key: "hot", label: "Hot list" },
  { key: "projections", label: "Projections" },
  { key: "churn", label: "Churn" },
  { key: "mine", label: "My money" },
  { key: "invoices", label: "Invoices" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export function MoneyPage() {
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab");
  const tab: Tab = TABS.some(t => t.key === asked) ? (asked as Tab) : "billing";
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <PageHeader
        title="Money"
        sub="Who pays next, who can buy more, who renews, who left, what you earn, and the invoices you issue."
      >
        <div className="mt-3">
          <PillRow>
            {TABS.map(t => (
              <Pill
                key={t.key}
                active={t.key === tab}
                onClick={() => setParams({ tab: t.key })}
              >
                {t.label}
              </Pill>
            ))}
          </PillRow>
        </div>
      </PageHeader>
      {tab === "billing" ? <BillingPage embedded /> : null}
      {tab === "hot" ? <HotListPage embedded /> : null}
      {tab === "projections" ? <ProjectionsPage embedded /> : null}
      {tab === "churn" ? <ChurnPage embedded /> : null}
      {tab === "mine" ? <MyMoneyPage embedded /> : null}
      {tab === "invoices" ? <InvoicesPage embedded /> : null}
    </div>
  );
}
