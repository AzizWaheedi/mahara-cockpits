import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
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
import type { ClientCallReceipt } from "@/lib/checkInClient";
import {
  editProjections,
  projectionCommand,
  readProjections,
} from "@/lib/projectionsClient";
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
export function ProjectionsPage({ embedded = false }: { embedded?: boolean }) {
  const [params, setParams] = useSearchParams();
  const forEmail = params.get("for") ?? undefined;
  const { client, session } = useCockpitAuth();
  const scope = `${session?.user.id ?? ""}:${forEmail ?? ""}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [loaded, setLoaded] = useState<{ scope: string; page: Page } | null>(
    null,
  );
  const page = loaded?.scope === scope ? loaded.page : undefined;
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const next = await readProjections(client, { forEmail });
      if (currentScope.current === scope) {
        setLoaded({ scope, page: next });
        setError(null);
      }
    } catch (e) {
      if (currentScope.current === scope)
        setError(
          e instanceof Error
            ? e.message
            : "Projections could not be read. Try again.",
        );
    }
  }, [client, forEmail, scope]);
  useEffect(() => {
    setError(null);
    void reload();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, 60_000);
    return () => clearInterval(timer);
  }, [reload]);
  const [openTask, setOpenTask] = useState<string | null>(params.get("client"));
  const [reading, setReading] = useState(false);
  /** What the last "Read billing again" found, said on the page, not only in a toast. */
  const [lastRead, setLastRead] = useState<string | null>(null);
  const [pendingPlans, setPendingPlans] = useState<
    {
      scope: string;
      taskId: string;
      clientName: string;
      receipt: ClientCallReceipt;
      saving: boolean;
      error: string | null;
    }[]
  >([]);

  const onEdit: Edit = async e => {
    const next = await editProjections(client, e, { forEmail });
    if (currentScope.current === scope) setLoaded({ scope, page: next });
  };
  const saveBookedPlan = async (
    taskId: string,
    clientName: string,
    receipt: ClientCallReceipt,
  ) => {
    if (currentScope.current !== scope) return;
    const pending = {
      scope,
      taskId,
      clientName,
      receipt,
      saving: true,
      error: null,
    };
    setPendingPlans(rows => [
      ...rows.filter(row => row.scope !== scope || row.taskId !== taskId),
      pending,
    ]);
    try {
      await onEdit({
        kind: "plan",
        taskId,
        patch: { callBookedFor: receipt.startTime },
      });
      if (currentScope.current === scope) {
        setPendingPlans(rows =>
          rows.filter(row => row.scope !== scope || row.taskId !== taskId),
        );
      }
    } catch (error) {
      if (currentScope.current === scope) {
        const message =
          error instanceof Error
            ? error.message
            : "The plan could not be saved.";
        setPendingPlans(rows =>
          rows.map(row =>
            row.scope === scope && row.taskId === taskId
              ? { ...row, saving: false, error: message }
              : row,
          ),
        );
      }
    }
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
      const r = await projectionCommand(
        client,
        "projections.refreshBillingNow",
        {},
      );
      await reload();
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
      toast.error(e instanceof Error ? e.message : "Billing could not be read");
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

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {pendingPlans
        .filter(row => row.scope === scope)
        .map(row => (
          <section
            key={row.taskId}
            role={row.error ? "alert" : "status"}
            className="space-y-2 rounded-xl border border-warning/40 p-4 text-sm"
          >
            <p>
              {row.clientName}: the appointment is booked for{" "}
              {callLabel(row.receipt.startTime)}.
            </p>
            <p className="text-xs text-muted-foreground">
              Appointment receipt: {row.receipt.appointmentId}
            </p>
            <p>
              {row.error
                ? `The plan was not updated. ${row.error}`
                : "Saving the booked time to the plan…"}
            </p>
            {row.error ? (
              <Button
                size="sm"
                variant="outline"
                disabled={row.saving}
                onClick={() =>
                  void saveBookedPlan(row.taskId, row.clientName, row.receipt)
                }
              >
                Retry saving the plan
              </Button>
            ) : null}
            <p className="text-xs text-muted-foreground">
              This retry only saves the plan. It does not book another
              appointment.
            </p>
          </section>
        ))}
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
            bookWith={row => {
              const pending = pendingPlans.find(
                pending =>
                  pending.scope === scope && pending.taskId === row.taskId,
              );
              return pending ? (
                <div
                  className="space-y-2 text-sm"
                  role={pending.error ? "alert" : "status"}
                >
                  <p>
                    The appointment is booked for{" "}
                    {callLabel(pending.receipt.startTime)}. Do not book it
                    again.
                  </p>
                  <p className="text-xs">
                    Appointment receipt: {pending.receipt.appointmentId}
                  </p>
                  <p>
                    {pending.error ?? "Saving the booked time to the plan…"}
                  </p>
                  {pending.error ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending.saving}
                      onClick={() =>
                        void saveBookedPlan(
                          pending.taskId,
                          pending.clientName,
                          pending.receipt,
                        )
                      }
                    >
                      Retry saving the plan
                    </Button>
                  ) : null}
                </div>
              ) : (
                <BookCallButton
                  taskId={row.taskId}
                  clientName={row.clientName}
                  kind="checkin"
                  onBooked={receipt =>
                    saveBookedPlan(row.taskId, row.clientName, receipt)
                  }
                >
                  Book it at a free time
                </BookCallButton>
              );
            }}
          />
        </>
      )}
    </div>
  );
}
