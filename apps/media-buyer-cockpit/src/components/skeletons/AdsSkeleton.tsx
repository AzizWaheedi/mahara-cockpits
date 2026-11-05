import { rememberedSkeleton } from "@/components/RememberedSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { readBillingStripShown } from "@/lib/billingStripShape";
import "@/components/ceo/ceo.css";

/** The route paths AdsSkeleton stands for. */
export const ADS_SKELETON_PATHS = ["/ads"];

const CARD = "rounded-2xl border bg-card p-4 sm:p-6";

const rows = (n: number) => Array.from({ length: n }, (_, i) => i);

const pill = (on: boolean) =>
  `inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors ${
    on
      ? "border-primary/40 bg-primary/15 text-foreground"
      : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
  }`;

const TILE_LABELS = [
  "Client spend, 7 days",
  "Client leads, 7 days",
  "Blended CPL",
  "Under the $30/day floor",
  "Not on the board",
];

const COLUMNS = [
  "Campaign",
  "Spend",
  "Leads",
  "CPL",
  "Bookings",
  "Cost / booking",
  "Budget / spend",
  "Call",
];

function StatTilesSkeleton() {
  return (
    <div data-section="stat-tiles" className="@container">
      <div className="grid grid-cols-2 gap-4 @3xl:grid-cols-5">
        {TILE_LABELS.map((label, i) => (
          <div
            key={label}
            className={`min-w-0 rounded-2xl border bg-card p-4 ${i === 0 ? "col-span-2 @3xl:col-span-1" : ""}`}
          >
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 whitespace-nowrap text-2xl font-semibold tracking-tight tabular-nums">
              <Skeleton className="h-7 w-20 max-w-full" />
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Skeleton className="h-3 w-24 max-w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TrackingBacklogSkeleton() {
  return (
    <section
      data-section="tracking-backlog"
      className="rounded-2xl border bg-card p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h2 className="text-[15px] font-semibold">Tracking backlog</h2>
          <div className="mt-1 text-sm">
            <div className="flex h-5 items-center">
              <Skeleton className="h-3.5 w-full max-w-xl" />
            </div>
            <div className="flex h-5 items-center">
              <Skeleton className="h-3.5 w-2/3 max-w-xl" />
            </div>
          </div>
        </div>
        <Skeleton className="h-8 w-16 rounded-md" />
      </div>
    </section>
  );
}

/**
 * The Payments row as it looked on the last load: icon, label, what it says
 * and its two buttons. Today and Ads draw it only after it has shown once.
 */
export function BillingStripSkeleton({
  section = true,
}: {
  section?: boolean;
}) {
  return (
    <div
      data-section={section ? "billing-strip" : undefined}
      className="ceo-root rounded-xl border text-sm"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 sm:px-4">
        <Skeleton className="order-1 size-4 shrink-0 rounded" />
        <div className="order-2 flex-1 sm:flex-none sm:shrink-0">
          <Skeleton className="h-4 w-20 max-w-full" />
        </div>
        <div className="order-4 flex min-w-0 basis-full flex-wrap items-center gap-x-2 gap-y-1.5 sm:basis-0 sm:flex-1">
          <Skeleton className="h-4 w-56 max-w-full" />
        </div>
        <div className="order-5 shrink-0">
          <Skeleton className="h-7 w-40 rounded-md" />
        </div>
        <div className="order-3 shrink-0 sm:order-6">
          <Skeleton className="h-7 w-16 rounded-md" />
        </div>
      </div>
    </div>
  );
}

/** One text line in the sweep, in the loaded line box. */
function SweepLine() {
  return (
    <span className="relative block flex-1 text-sm leading-snug">
      <span className="invisible">&nbsp;</span>
      <Skeleton className="absolute inset-x-0 top-[3px] bottom-[3px] w-3/4" />
    </span>
  );
}

function SweepSkeleton() {
  return (
    <section data-section="sweep" className={CARD}>
      <h2 className="text-[15px] font-semibold">
        Middle of the day: the sweep
      </h2>
      <div className="mt-4 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows(7).map(i => (
          <div
            key={i}
            data-sweep-row
            className="flex items-start gap-2.5 rounded-lg py-1.5 text-left"
          >
            <Skeleton className="mt-0.5 size-4 flex-none rounded" />
            {i === 1 ? (
              <span className="min-w-0 flex-1">
                <SweepLine />
                <SweepLine />
              </span>
            ) : (
              <SweepLine />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function CampaignBoardSkeleton() {
  return (
    <section
      id="ads-board"
      data-section="campaign-board"
      className={`${CARD} scroll-mt-6`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Which campaigns"
        >
          {["Running", "Nothing running", "Off the board"].map((label, i) => (
            <span key={label} className={pill(i === 0)}>
              {label}
              <Skeleton className="ml-1.5 h-3 w-4" />
            </span>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          USD, currency-corrected
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl bg-muted/40 px-3 py-2">
        <Skeleton className="h-8 w-40 rounded-md" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>

      <div className="mt-4 -mx-1 flex flex-nowrap gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden">
        {["Everything", "Critical", "Below KPI"].map((label, i) => (
          <span key={label} className={pill(i === 0)}>
            {label}
            <Skeleton className="ml-1.5 h-3 w-4" />
          </span>
        ))}
        <span className={pill(false)}>More filters</span>
      </div>

      <div className="@container mt-4 overflow-x-auto">
        <table className="campaign-board w-full text-[14px]">
          <thead>
            <tr className="border-b font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              {COLUMNS.map((column, i) => (
                <th
                  key={column}
                  className={
                    i === 0
                      ? "py-2 pr-2 text-left font-medium"
                      : "px-2 text-left font-medium"
                  }
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows(5).map(i => (
              <tr key={i} className="campaign-summary border-b align-top">
                <td className="py-2.5 pr-2">
                  <Skeleton className="h-4 w-40 max-w-full" />
                  <Skeleton className="mt-1 h-3 w-20 max-w-full" />
                </td>
                {rows(7).map(j => (
                  <td key={j} className="px-2 py-2.5">
                    <Skeleton className="h-4 w-14 max-w-full" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The Ads page with its data held back, so the board keeps its shape. */
function AdsSkeletonStatic() {
  return (
    <div
      aria-hidden="true"
      data-page-skeleton="ads"
      className="mx-auto w-full space-y-6 max-w-[1440px]"
    >
      <header
        data-section="ads-header"
        className="flex flex-wrap items-end justify-between gap-3"
      >
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Ads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <Skeleton className="inline-block h-4 w-64 max-w-full align-middle" />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-32 rounded-md" />
          <Skeleton className="h-8 w-32 rounded-md" />
        </div>
      </header>

      {readBillingStripShown() ? <BillingStripSkeleton /> : null}

      <StatTilesSkeleton />
      <TrackingBacklogSkeleton />
      <SweepSkeleton />
      <CampaignBoardSkeleton />
    </div>
  );
}

export const AdsSkeleton = rememberedSkeleton("ads", AdsSkeletonStatic);
