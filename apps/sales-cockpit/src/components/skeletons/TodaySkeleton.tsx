import { page, SectionCard, StatTile } from "../kit";
import { rememberedSkeleton } from "../RememberedSkeleton";
import { Skeleton } from "../ui/skeleton";

const ROWS = [0, 1, 2];

/** The three rows a `Reading` draws inside a flushed card. */
function ReadingRows({ className = "" }: { className?: string }) {
  return (
    <div className={`min-w-0 max-w-full ${className}`}>
      <div className="space-y-3">
        {ROWS.map(i => (
          <div key={i} className="flex min-w-0 max-w-full items-center gap-3">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="min-w-0 max-w-full flex-1 space-y-1.5">
              <Skeleton className="h-3 w-2/5" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The day band's scale and colour key, which never change. */
function DayLineKey() {
  return (
    <div className="muted mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          data-state="coming"
          className="dayline-call"
          style={{
            position: "static",
            width: "0.9rem",
            height: "0.6rem",
            minWidth: 0,
            padding: 0,
          }}
        />
        Coming up
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          data-state="owed"
          className="dayline-call"
          style={{
            position: "static",
            width: "0.9rem",
            height: "0.6rem",
            minWidth: 0,
            padding: 0,
          }}
        />
        Owed a mark
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          data-state="done"
          className="dayline-call"
          style={{
            position: "static",
            width: "0.9rem",
            height: "0.6rem",
            minWidth: 0,
            padding: 0,
          }}
        />
        Showed
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          data-state="missed"
          className="dayline-call"
          style={{
            position: "static",
            width: "0.9rem",
            height: "0.6rem",
            minWidth: 0,
            padding: 0,
          }}
        />
        No-show, cancelled or disqualified
      </span>
      <Skeleton className="ml-auto h-3 w-24" />
    </div>
  );
}

/**
 * "Rate these leads", drawn while its own read is still on the way, so the
 * cards under it stay where they are.
 */
export function AfterCallSectionSkeleton() {
  return (
    <div aria-hidden="true" data-section="after-call" className="min-w-0">
      <SectionCard
        title="Rate these leads"
        side={<span className="muted text-xs">Last 7 days</span>}
        flush
      >
        <p className="muted border-b hairline px-4 py-2 text-xs">
          Every call you held: how good the lead is, and for an intro with no
          demo, why. Your end of day waits on these.
        </p>
        <div className="divide-y hairline">
          {ROWS.map(i => (
            <div key={i} className="space-y-2.5 px-4 py-3">
              <div className="min-w-0 space-y-1.5">
                <Skeleton className="h-4 w-48 max-w-full" />
                <Skeleton className="h-3 w-64 max-w-full" />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-2 w-14 rounded-[2px]" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

/**
 * Today with its data held back: the same page frame, the same cards under
 * the same titles, and a skeleton block wherever a read will bring a value.
 */
function TodaySkeletonStatic() {
  return (
    <div aria-hidden="true" data-page-skeleton="today" className={page}>
      <header
        data-section="header"
        className="flex flex-wrap items-end justify-between gap-3"
      >
        <div className="min-w-0">
          <Skeleton className="h-8 w-56 max-w-full" />
          <Skeleton className="mt-1 h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-44 rounded-[14px]" />
      </header>

      <section
        aria-label="Your day"
        data-section="your-day"
        className="panel p-4 sm:p-6"
      >
        <Skeleton className="h-[52px] w-full rounded-[var(--radius-lg)]" />
        <Skeleton className="mt-1.5 h-3 w-full" />
        <DayLineKey />
        <ReadingRows className="mt-4 text-sm" />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
        <div className="min-w-0 space-y-4 lg:col-span-7 lg:space-y-6">
          <div data-section="owed" className="min-w-0">
            <SectionCard
              title="Mark these calls"
              side={<Skeleton className="h-4 w-16" />}
              flush
            >
              <ReadingRows className="px-4 py-3 text-sm" />
            </SectionCard>
          </div>

          <AfterCallSectionSkeleton />

          <div data-section="week" className="min-w-0">
            <SectionCard
              title="This week"
              side={<Skeleton className="h-4 w-20" />}
            >
              <div className="@container">
                <div className="grid grid-cols-2 gap-4 @lg:grid-cols-4">
                  <StatTile
                    variant="plain"
                    label="Scheduled"
                    value={<Skeleton className="h-8 w-16" />}
                  />
                  <StatTile
                    variant="plain"
                    label="Shown"
                    value={<Skeleton className="h-8 w-16" />}
                  />
                  <StatTile
                    variant="plain"
                    label="Closes"
                    value={<Skeleton className="h-8 w-16" />}
                  />
                  <StatTile
                    variant="plain"
                    label="Deposits typed"
                    value={<Skeleton className="h-8 w-16" />}
                  />
                </div>
              </div>
              <p className="muted mt-4 text-xs">
                Saturday to today, from the same rep scorecard the CEO cockpit
                reads. A call nobody marked counts as shown until it is marked.
              </p>
            </SectionCard>
          </div>
        </div>

        <div className="min-w-0 space-y-4 lg:col-span-5 lg:space-y-6">
          <div data-section="your-tasks" className="min-w-0">
            <section className="tk-card">
              <header className="tk-card-head">
                <h2 className="tk-card-title">Your tasks</h2>
              </header>
              <div className="tk-card-body">
                <ReadingRows />
              </div>
            </section>
          </div>

          <div data-section="coming-up" className="min-w-0">
            <SectionCard
              title="Coming up"
              side={<span className="muted text-xs">Next 36 hours</span>}
              flush
            >
              <ReadingRows className="px-4 py-3 text-sm" />
            </SectionCard>
          </div>

          <div data-section="waiting-replies" className="min-w-0">
            <SectionCard
              title="Waiting on a reply"
              side={<Skeleton className="h-4 w-24" />}
              flush
            >
              <ReadingRows className="px-4 py-3 text-sm" />
            </SectionCard>
          </div>

          <div data-section="new-leads" className="min-w-0">
            <SectionCard
              title="New leads"
              side={<span className="muted text-xs">Last 48 hours</span>}
              flush
            >
              <ReadingRows className="px-4 py-3 text-sm" />
            </SectionCard>
          </div>
        </div>
      </div>
    </div>
  );
}

export const TodaySkeleton = rememberedSkeleton("today", TodaySkeletonStatic, {
  className: page,
});

export const TODAY_SKELETON_PATHS: string[] = ["/"];
