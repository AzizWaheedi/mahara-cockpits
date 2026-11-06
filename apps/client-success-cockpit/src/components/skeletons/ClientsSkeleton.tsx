import { PageHeader } from "@/components/kit";
import { rememberedSkeleton } from "@/components/RememberedSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The Clients page with its data held back: the header, the view pills, the
 * search box and five client rows, so the page does not move when the list
 * arrives.
 */

export const CLIENTS_SKELETON_PATHS = ["/clients"];

const VIEWS = ["All", "Onboarding", "Live", "Results"] as const;

/** One client row: the dot, the name, the chips, the next step and the clocks. */
function ClientRowSkeleton() {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl border bg-card px-4 py-3 sm:px-6 sm:py-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Skeleton className="size-2 rounded-full" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <Skeleton className="mt-1.5 h-4 w-3/4" />
        <Skeleton className="mt-1.5 h-3 w-56" />
      </div>
      <Skeleton className="mt-0.5 size-4 shrink-0 rounded-sm" />
    </div>
  );
}

function ClientsSkeletonStatic() {
  return (
    <div
      aria-hidden="true"
      data-page-skeleton="clients"
      className="mx-auto w-full max-w-6xl space-y-6"
    >
      <div data-section="page-header">
        <PageHeader
          title="Clients"
          sub="Every client you look after. Open one for everything about them."
          actions={
            <>
              <Skeleton className="h-8 w-32 rounded-lg" />
              <Skeleton className="h-8 w-32 rounded-lg" />
            </>
          }
        />
      </div>

      <div className="space-y-4">
        <div
          data-section="client-filters"
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <div className="no-scrollbar relative -mx-1 flex flex-nowrap items-center gap-1 overflow-x-auto px-1 py-0.5">
            {VIEWS.map(view => (
              <span
                key={view}
                className="inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-xs font-medium text-muted-foreground"
              >
                {view}
                {view === "Results" ? null : (
                  <Skeleton className="ml-1 h-3 w-5" />
                )}
              </span>
            ))}
          </div>
          <Skeleton className="h-9 w-full rounded-lg sm:w-64" />
        </div>

        <div data-section="client-list" className="space-y-3">
          {[0, 1, 2, 3, 4].map(i => (
            <ClientRowSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

export const ClientsSkeleton = rememberedSkeleton(
  "clients",
  ClientsSkeletonStatic,
);
