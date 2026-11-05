import { Skeleton } from "@/components/ui/skeleton";

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

function TrackingBacklogSkeleton() {
  return (
    <section
      data-section="tracking-backlog"
      className="rounded-2xl border bg-card p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h2 className="text-[15px] font-semibold">Tracking backlog</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            <Skeleton className="h-4 w-full max-w-xl" />
            <Skeleton className="mt-1 h-4 w-2/3 max-w-xl" />
          </p>
        </div>
        <Skeleton className="h-8 w-16 rounded-md" />
      </div>
    </section>
  );
}

function SweepSkeleton() {
  return (
    <section data-section="sweep" className={CARD}>
      <h2 className="text-[15px] font-semibold">
        Middle of the day: the sweep
      </h2>
      <div className="mt-4 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows(5).map(i => (
          <div
            key={i}
            className="flex items-start gap-2.5 rounded-lg py-1.5 text-left"
          >
            <Skeleton className="mt-0.5 size-4 flex-none rounded" />
            <Skeleton className="h-4 w-3/4 max-w-full" />
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
export function AdsSkeleton() {
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

      <StatTilesSkeleton />
      <TrackingBacklogSkeleton />
      <SweepSkeleton />
      <CampaignBoardSkeleton />
    </div>
  );
}
