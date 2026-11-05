import { SectionCard } from "@/components/ceo/SectionCard";
import { rememberedSkeleton } from "@/components/RememberedSkeleton";
import { BillingStripSkeleton } from "@/components/skeletons/AdsSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { readBillingStripShown } from "@/lib/billingStripShape";
import { readWaDeskShape } from "@/lib/waDeskShape";
import "@/components/ceo/ceo.css";
import "@/components/tasks/tasks.css";

/** The route paths TodaySkeleton stands for. */
export const TODAY_SKELETON_PATHS = ["/dashboard"];

const CARD = "rounded-2xl border bg-card p-4 sm:p-6";

const rows = (n: number) => Array.from({ length: n }, (_, i) => i);

/** One thread card while the desk list is pending, sized like the real row. */
function ThreadRowSkeleton() {
  return (
    <li className="rounded-2xl border bg-card">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2 sm:px-6">
        <Skeleton className="h-4 w-32 max-w-full" />
        <Skeleton className="h-3 w-8" />
        <Skeleton className="ml-auto h-8 w-20 rounded-lg" />
      </div>
      <div className="space-y-1.5 px-4 py-3 sm:px-6">
        <Skeleton className="h-4 w-4/5 max-w-full" />
        <Skeleton className="h-4 w-3/5 max-w-full" />
      </div>
      <div className="border-t px-4 py-3 sm:px-6 sm:py-4">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="mt-2 h-9 w-24 rounded-lg" />
      </div>
    </li>
  );
}

/**
 * The WhatsApp block while its own read is pending. A desk without its own
 * WhatsApp shows one quiet line, so that line keeps its height. A desk with
 * the list last time shows the heading and four thread cards.
 */
export function WhatsAppStatusSkeleton({ desk = "ads" }: { desk?: string }) {
  if (readWaDeskShape(desk) === "line")
    return (
      <div data-section="whatsapp" className="text-sm">
        <Skeleton className="h-5 w-72 max-w-full" />
      </div>
    );

  return (
    <section data-section="whatsapp">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-[15px] font-semibold tracking-tight">WhatsApp</h2>
        <Skeleton className="h-3 w-40 max-w-full" />
      </div>
      <ul className="mt-3 space-y-3">
        {rows(4).map(i => (
          <ThreadRowSkeleton key={i} />
        ))}
      </ul>
    </section>
  );
}

/**
 * The Exception alerts card while its own read is pending. The loaded card
 * reads cockpit_exception_state after the page snapshot, so its body is drawn
 * here rather than left to appear later.
 */
export function ExceptionAlertsSkeleton() {
  return (
    <div data-section="exception-alerts">
      <SectionCard
        title="Exception alerts"
        description="Clients whose numbers broke, checked every hour. A client shows here after two checks in a row and leaves after two clean ones."
      >
        <ul className="-mx-4 divide-y border-y sm:-mx-6">
          {rows(3).map(i => (
            <li key={i}>
              <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Skeleton className="h-4 w-32 max-w-full" />
                    <Skeleton className="h-5 w-24 rounded-full" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <Skeleton className="mt-1 h-4 w-3/4 max-w-full" />
                </div>
                <Skeleton className="size-4 shrink-0" />
              </div>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}

function YourTasksSkeleton() {
  return (
    <section data-section="your-tasks" className="tk-card">
      <header className="tk-card-head">
        <h2 className="tk-card-title">Your tasks</h2>
      </header>
      <ul className="tk-list">
        {rows(5).map(i => (
          <li key={i}>
            <div className="tk-row">
              <span className="tk-spine" aria-hidden />
              <div className="tk-row-title">
                <Skeleton className="h-4 w-3/4 max-w-full" />
              </div>
              <div className="tk-row-client">
                <Skeleton className="h-3 w-24 max-w-full" />
              </div>
              <div className="tk-row-due">
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className="tk-more">
        <span>See all</span>
        <Skeleton className="size-4" />
      </div>
    </section>
  );
}

function MorningSprintSkeleton() {
  return (
    <section data-section="morning-sprint" className={CARD}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold">Morning sprint</h2>
        <Skeleton className="h-3 w-14" />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Clear communication first, in this order, then get into the accounts.
      </p>
      <ol className="mt-4 divide-y">
        {rows(5).map(i => (
          <li
            key={i}
            className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
          >
            <Skeleton className="mt-0.5 size-5 flex-none rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-3/4 max-w-full" />
              <Skeleton className="mt-1 h-3 w-1/2 max-w-full" />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The Today page with its data held back, so the first screen keeps its shape. */
function TodaySkeletonStatic() {
  return (
    <div
      aria-hidden="true"
      data-page-skeleton="today"
      className="mx-auto w-full space-y-6 max-w-6xl"
    >
      <header
        data-section="today-header"
        className="flex flex-wrap items-end justify-between gap-3"
      >
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <Skeleton className="inline-block h-4 w-64 max-w-full align-middle" />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-48 max-w-full rounded-md" />
          <Skeleton className="h-8 w-28 rounded-md" />
          <Skeleton className="h-8 w-32 rounded-md" />
        </div>
      </header>

      {readBillingStripShown() ? <BillingStripSkeleton /> : null}

      <WhatsAppStatusSkeleton />

      <div className="space-y-6">
        <ExceptionAlertsSkeleton />
        <YourTasksSkeleton />
        <MorningSprintSkeleton />
      </div>
    </div>
  );
}

export const TodaySkeleton = rememberedSkeleton("today", TodaySkeletonStatic);
