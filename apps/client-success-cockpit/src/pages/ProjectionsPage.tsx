import { useAction, useMutation, useQuery } from "convex/react";
import { Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { BookCallButton } from "@/components/ClientCheckIn";
import { PageHeader, Pill, PillRow } from "@/components/kit";
import {
  type Book,
  type Edit,
  GoldLibrary,
  HistoryTable,
  PlanDrawer,
  ProjectionStrip,
  RenewalWindow,
} from "@/components/projections/ProjectionsKit";
import { ReportIssue } from "@/components/ReportIssue";
import { Button } from "@/components/ui/button";
import type { ProjectionsPage as Page } from "@/lib/projectionsView";
import { callLabel } from "@/lib/projectionsView";
import { api } from "../../convex/_generated/api";

/**
 * Projections: the week in five numbers and the renewal window.
 *
 * The CEO, 2026-09-27: blood and stretch for re-sells, renewals, cash,
 * reviews and referrals, set every Sunday; every client whose contract ends
 * in the next 60 days planned, with a proactive call booked or a reason
 * written, and a gold-standard library of recorded calls. The Sunday
 * "Renewals & Re-sell Projections" meeting shows the same parts on its
 * page in the Team meetings screen (the shared ProjectionsKit).
 */
export function ProjectionsPage({ embedded = false }: { embedded?: boolean }) {
  const [params, setParams] = useSearchParams();
  const forEmail = params.get("for") ?? undefined;
  const page = useQuery(api.projections.page, forEmail ? { forEmail } : {}) as
    | Page
    | undefined;
  const edit = useMutation(api.projections.edit);
  const bookCall = useAction(api.projections.bookCall);
  const readBilling = useAction(api.projections.refreshBillingNow);
  const [openTask, setOpenTask] = useState<string | null>(params.get("client"));
  const [reading, setReading] = useState(false);
  /** What the last "Read billing again" found, said on the page, not only in a toast. */
  const [lastRead, setLastRead] = useState<string | null>(null);

  const onEdit: Edit = async e => {
    await edit({ edit: e });
  };
  const onBook: Book = async a => {
    const done = await bookCall(a);
    toast.success(`Booked for ${callLabel(done.when)}`);
  };
  const open = (taskId: string | null) => {
    setOpenTask(taskId);
    const next = new URLSearchParams(params);
    if (taskId) next.set("client", taskId);
    else next.delete("client");
    setParams(next, { replace: true });
  };
  const refresh = async () => {
    setReading(true);
    try {
      const r = await readBilling({});
      const at = new Date().toLocaleTimeString("en-GB", {
        timeZone: "Asia/Kuwait",
        hour: "2-digit",
        minute: "2-digit",
      });
      if (r.ok) {
        const line = `Billing read again at ${at}: ${
          typeof r.payments === "number"
            ? `${r.payments} payment${r.payments === 1 ? "" : "s"} in the ledger`
            : "the ledger answered"
        }. Actuals below use it.`;
        setLastRead(line);
        toast.success(line);
      } else {
        setLastRead(
          `Billing could not be read at ${at}: ${r.error ?? "no reason given"}.`,
        );
        toast.error(r.error ?? "Billing could not be read");
      }
    } catch (e) {
      toast.error(
        (e as { data?: { message?: string } })?.data?.message ??
          "Billing could not be read",
      );
    } finally {
      setReading(false);
    }
  };

  return (
    <div
      className={embedded ? "space-y-6" : "mx-auto w-full max-w-6xl space-y-6"}
    >
      <PageHeader
        as={embedded ? "h2" : "h1"}
        title="Projections"
        sub="Blood is the floor and stretch the goal. Actuals fill in from what is logged."
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refresh()}
              disabled={reading}
            >
              {reading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Read billing again
            </Button>
            {/* Inside Money, the page's own report button covers it. */}
            {embedded ? null : <ReportIssue page="projections" />}
          </>
        }
      >
        {lastRead ? (
          <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
            {lastRead}
          </p>
        ) : null}
        {page?.canEditOthers && page.owners.length > 1 ? (
          <div className="mt-3">
            <PillRow>
              {page.owners.map(o => (
                <Pill
                  key={o}
                  active={o === page.owner}
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    next.set("for", o);
                    setParams(next, { replace: true });
                  }}
                >
                  {o}
                </Pill>
              ))}
            </PillRow>
          </div>
        ) : null}
      </PageHeader>

      {page === undefined ? (
        <div className="space-y-6" aria-busy>
          {[0, 1].map(i => (
            <div
              key={i}
              className="h-64 animate-pulse rounded-2xl border bg-card"
            />
          ))}
        </div>
      ) : (
        <>
          <ProjectionStrip page={page} onEdit={onEdit} />
          <RenewalWindow page={page} onOpen={open} />
          <HistoryTable page={page} onEdit={onEdit} />
          <GoldLibrary gold={page.gold} />
          <PlanDrawer
            page={page}
            taskId={openTask}
            onClose={() => open(null)}
            onEdit={onEdit}
            onBook={onBook}
            // The same booking as a client's page: HighLevel's free times
            // only, then the time goes on the plan.
            bookWith={(row, done) => (
              <BookCallButton
                taskId={row.taskId}
                clientName={row.clientName}
                kind="checkin"
                onBooked={receipt => void done(receipt.startTime)}
              >
                Book it at a free time
              </BookCallButton>
            )}
          />
        </>
      )}
    </div>
  );
}
