import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { editProjections, projectionCommand, readProjections } from "@/lib/projectionsClient";
import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
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
export function ProjectionsPage() {
  const [params, setParams] = useSearchParams();
  const forEmail = params.get("for") ?? undefined;
  const { client, session } = useCockpitAuth();
  const scope = `${session?.user.id ?? ""}:${forEmail ?? ""}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [loaded, setLoaded] = useState<{scope:string;page:Page} | null>(null);
  const page = loaded?.scope === scope ? loaded.page : undefined;
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const next = await readProjections(client, {forEmail});
      if (currentScope.current === scope) { setLoaded({scope,page:next}); setError(null); }
    } catch (e) {
      if (currentScope.current === scope) setError(e instanceof Error ? e.message : "Projections could not be read. Try again.");
    }
  }, [client, forEmail, scope]);
  useEffect(() => {
    setError(null);
    void reload();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void reload(); }, 60_000);
    return () => clearInterval(timer);
  }, [reload]);
  const [openTask, setOpenTask] = useState<string | null>(params.get("client"));
  const [reading, setReading] = useState(false);

  const onEdit: Edit = async e => {
    const next = await editProjections(client, e, {forEmail});
    if (currentScope.current === scope) setLoaded({scope,page:next});
  };
  const onBook: Book = async a => {
    const done = await projectionCommand(client, "projections.bookCall", a);
    toast.success(`Booked for ${callLabel(done.when)}`);
    await reload();
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
      const r = await projectionCommand(client, "projections.refreshBillingNow", {});
      await reload();
      if (r.ok) toast.success("Billing read again");
      else toast.error(r.error ?? "Billing could not be read");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Billing could not be read",
      );
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <PageHeader
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
            <ReportIssue page="projections" />
          </>
        }
      >
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

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
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
          />
        </>
      )}
    </div>
  );
}
