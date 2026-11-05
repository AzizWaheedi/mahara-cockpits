import { lazy, Suspense, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import {
  LogWinButton,
  LogWinSheet,
  MoneyWins,
  winsApi,
} from "@/components/ClientWins";
import { PageHeader, Pill, PillRow } from "@/components/kit";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { SopVideo } from "@/components/SopVideo";
import { useCsmSnapshot } from "@/lib/useCsmSnapshot";
import type { WinsRead } from "@/lib/wins";
import { BillingPage } from "./BillingPage";
import { ChurnPage } from "./ChurnPage";
import { HotListPage, MyMoneyPage, useW56Doors } from "./CsmPage";
import { InvoicesPage } from "./InvoicesPage";
import { TAB_VIDEO } from "./money/tabVideos";
import { ProjectionsPage } from "./ProjectionsPage";

const OffersTab = lazy(() =>
  import("./money/offers/OffersTab").then(m => ({ default: m.OffersTab })),
);

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
  { key: "offers", label: "Offers" },
  { key: "wins", label: "Wins" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export function MoneyPage() {
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab");
  const tab: Tab = TABS.some(t => t.key === asked) ? (asked as Tab) : "billing";
  const video = TAB_VIDEO[tab];
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
      {video ? <SopVideo video={video} /> : null}
      {tab === "billing" ? <BillingPage embedded /> : null}
      {tab === "hot" ? <HotListPage embedded /> : null}
      {tab === "projections" ? <ProjectionsPage embedded /> : null}
      {tab === "churn" ? <ChurnPage embedded /> : null}
      {tab === "mine" ? <MyMoneyPage embedded /> : null}
      {tab === "invoices" ? <InvoicesPage embedded /> : null}
      {tab === "wins" ? <WinsTab /> : null}
      {tab === "offers" ? (
        <Suspense
          fallback={
            <LoadingSkeleton variant="table" label="Loading offers" rows={5} />
          }
        >
          <OffersTab />
        </Suspense>
      ) : null}
    </div>
  );
}

/**
 * Wins across your clients (docs/forms/WAVE56-CONTRACT.md 5.2): the ribbons,
 * the four tiles, and Log a win for a client picked here.
 */
function WinsTab() {
  const auth = useCockpitAuth();
  const doors = useW56Doors(auth.client);
  const api = useMemo(
    () => (auth.client ? winsApi(auth.client) : null),
    [auth.client],
  );
  const { snap } = useCsmSnapshot(auth.client);
  const clients: { taskId: string; name: string }[] = (snap?.clients ?? [])
    .map((c: { taskId?: unknown; name?: unknown }) => ({
      taskId: String(c.taskId ?? ""),
      name: String(c.name ?? ""),
    }))
    .filter((c: { taskId: string }) => c.taskId);
  const [pick, setPick] = useState("");
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<WinsRead | null>(null);
  const [version, setVersion] = useState(0);
  const chosen = clients.find(c => c.taskId === pick) ?? null;
  return (
    <div className="space-y-4">
      {doors?.wins.open ? (
        <div className="flex flex-wrap items-center gap-2">
          <label
            className="text-xs text-muted-foreground"
            htmlFor="wins-client"
          >
            Client
          </label>
          <select
            id="wins-client"
            className="h-9 rounded-lg border bg-background px-2 text-sm"
            value={pick}
            onChange={e => setPick(e.target.value)}
          >
            <option value="">Pick a client</option>
            {clients.map(c => (
              <option key={c.taskId} value={c.taskId}>
                {c.name}
              </option>
            ))}
          </select>
          {chosen ? (
            <LogWinButton
              door={doors.wins}
              onClick={() => {
                setRead(null);
                setOpen(true);
                if (api)
                  void api
                    .read(chosen.taskId)
                    .then(setRead)
                    .catch(() => setRead(null));
              }}
            />
          ) : null}
        </div>
      ) : null}
      <MoneyWins key={version} api={api} door={doors?.wins ?? null} />
      {api && chosen && open ? (
        <LogWinSheet
          open
          onOpenChange={setOpen}
          api={api}
          taskId={chosen.taskId}
          client={chosen.name}
          context={read?.context ?? { proposals: [], deals: [] }}
          onSent={() => setVersion(v => v + 1)}
        />
      ) : null}
    </div>
  );
}
