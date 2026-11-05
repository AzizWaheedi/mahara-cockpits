import { rememberedSkeleton } from "@/components/RememberedSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

const ROWS = [0, 1, 2, 3, 4];
const FILTER_WIDTHS = ["w-24", "w-32", "w-20", "w-28", "w-24"];

function ClientsSkeletonStatic() {
  return (
    <div
      aria-hidden="true"
      data-page-skeleton="clients"
      className="launch-page client-directory"
    >
      <header className="launch-page-header" data-section="page-header">
        <div>
          <p className="launch-eyebrow">Media buyer · Your client book</p>
          <h1>Clients</h1>
          <p>
            Every account, every stage. Open a client to manage their next move.
          </p>
        </div>
        <div className="launch-search">
          <Skeleton className="size-[17px] shrink-0 rounded-full" />
          <Skeleton className="h-[42px] min-w-0 flex-1" />
        </div>
      </header>
      <div className="launch-status-line" data-section="client-status">
        <Skeleton className="h-3 w-56 max-w-full" />
        <Skeleton className="h-8 w-20" />
      </div>
      <div className="client-filters" data-section="client-filters">
        {FILTER_WIDTHS.map((width, i) => (
          <Skeleton key={i} className={`h-10 rounded-xl ${width}`} />
        ))}
      </div>
      <section className="client-book" data-section="client-book">
        <div className="client-book-head">
          <span>Client</span>
          <span>Status</span>
          <span>Ad accounts</span>
          <span>Next step</span>
          <span />
        </div>
        {ROWS.map(i => (
          <div className="client-book-row" key={i}>
            <div className="client-book-name">
              <Skeleton className="h-[38px] w-[34px] shrink-0 rounded-[11px]" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="h-3 w-48 max-w-full" />
              </div>
            </div>
            <div className="client-book-state space-y-2">
              <Skeleton className="h-4 w-24 max-w-full" />
              <Skeleton className="h-3 w-16 max-w-full" />
            </div>
            <div className="client-book-account space-y-2">
              <Skeleton className="h-4 w-32 max-w-full" />
              <Skeleton className="h-3 w-24 max-w-full" />
            </div>
            <div className="client-book-next space-y-2">
              <Skeleton className="h-4 w-full max-w-full" />
              <Skeleton className="h-3 w-2/3 max-w-full" />
            </div>
            <div className="client-open">
              <Skeleton className="h-4 w-full max-w-full" />
            </div>
          </div>
        ))}
      </section>
      <div className="launch-footer-note" data-section="footer-note">
        <span>
          Inactive clients stay visible. Campaigns are created paused, then
          switched on after review.
        </span>
        <Skeleton className="ml-auto h-4 w-16" />
      </div>
    </div>
  );
}

export const ClientsSkeleton = rememberedSkeleton(
  "clients",
  ClientsSkeletonStatic,
);

export function MetaHealthSkeleton() {
  return (
    <div aria-hidden="true" data-section="meta-health">
      <ul className="launch-checks">
        {[0, 1, 2, 3].map(i => (
          <li key={i}>
            <span className="launch-check-icon">
              <Skeleton className="size-5 rounded-full" />
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-full max-w-full" />
              <Skeleton className="h-3 w-3/5 max-w-full" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const CLIENTS_SKELETON_PATHS: string[] = ["/clients"];
