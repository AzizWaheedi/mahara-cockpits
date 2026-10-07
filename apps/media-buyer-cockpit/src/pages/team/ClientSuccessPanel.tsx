import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  type Book,
  DailyPanel,
  type Edit,
  PlanDrawer,
  ProjectionStrip,
  RenewalWindow,
} from "@/components/projections/ProjectionsKit";
import { api, useAction } from "@/lib/cockpitApi";
import type { ProjectionsPage } from "@/lib/projectionsView";
import { usePageVisible } from "@/lib/usePageVisible";
import { errorText } from "./teamKit";

/**
 * The client success cockpit's Projections screen on a meeting's page, the
 * same parts (ProjectionsKit) read live through the bridge. The Sunday
 * "Renewals & Re-sell Projections" meeting gets last week's and this week's
 * strip and the renewal window, opening on last week as its run of show
 * does; CSM Daily gets the hardest renewal for Tuesday's role play and the
 * gold-standard count for Thursday's review.
 */
export function ClientSuccessPanel({
  meetingId,
  embed,
}: {
  meetingId: string;
  embed: "cs-projections" | "cs-daily";
}) {
  const load = useAction(api.teamProjections.projections);
  const edit = useAction(api.teamProjections.projectionsEdit);
  const book = useAction(api.teamProjections.projectionsBook);
  const visible = usePageVisible();
  const [page, setPage] = useState<ProjectionsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPage((await load({ meetingId })) as ProjectionsPage);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [load, meetingId]);

  // The numbers move when the CSM logs a win in their own cockpit: read
  // them again every minute while the page is on screen.
  useEffect(() => {
    if (!visible) return;
    void refresh();
    const t = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(t);
  }, [refresh, visible]);

  const onEdit: Edit = async e => {
    const next = (await edit({
      meetingId,
      edit: e,
      ...(page?.owner ? { forEmail: page.owner } : {}),
    })) as ProjectionsPage;
    setPage(next);
    setError(null);
  };
  const onBook: Book = async a => {
    await book({ meetingId, ...a });
    await refresh();
  };

  if (!page)
    return (
      <section className="rounded-2xl border bg-card p-4 sm:p-6">
        {error ? (
          <p className="text-sm text-destructive">
            {error}{" "}
            <button
              type="button"
              onClick={() => void refresh()}
              className="text-primary underline-offset-4 hover:underline"
            >
              Try again
            </button>
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Reading the
            client success numbers
          </p>
        )}
      </section>
    );

  if (embed === "cs-daily") return <DailyPanel page={page} />;

  return (
    <div className="grid min-w-0 gap-6">
      <ProjectionStrip page={page} onEdit={onEdit} initial="last" />
      <RenewalWindow page={page} onOpen={setOpen} />
      <PlanDrawer
        page={page}
        taskId={open}
        onClose={() => setOpen(null)}
        onEdit={onEdit}
        onBook={onBook}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
