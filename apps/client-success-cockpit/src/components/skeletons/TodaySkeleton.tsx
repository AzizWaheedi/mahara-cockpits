import { PageHeader, SectionCard, StatTile } from "@/components/kit";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The Today page with its data held back. The header, the stat tiles, the
 * cards, the rows and the folds keep the loaded layout, so the page does not
 * move when the numbers arrive.
 */

export const TODAY_SKELETON_PATHS = ["/dashboard"];

/** The count beside a card title, drawn at the size of the number. */
const COUNT = (
  <Skeleton className="ml-1.5 inline-block h-3.5 w-4 align-middle" />
);

function Stat({ label }: { label: string }) {
  return <StatTile label={label} value={<Skeleton className="h-7 w-12" />} />;
}

/** A folded checklist row: the title line and the chevron on the right. */
function ChecklistRows({ rows }: { rows: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex w-full items-start justify-between gap-3 px-4 py-3 sm:px-6"
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <Skeleton className="h-4 w-56" />
          </span>
          <Skeleton className="mt-0.5 size-4 shrink-0 rounded-sm" />
        </div>
      ))}
    </>
  );
}

/** One client row, the shape the short lists and the board use. */
function ClientRows({ rows }: { rows: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-start justify-between gap-3 rounded-2xl border bg-card px-4 py-3 sm:px-6 sm:py-4"
        >
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
      ))}
    </>
  );
}

/** A short list: its fixed title, its count and five rows. */
function ShortListSkeleton({ title }: { title: string }) {
  return (
    <div className="space-y-3">
      <h2 className="text-[15px] font-semibold">
        {title}
        <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">
          <Skeleton className="inline-block h-3.5 w-4 align-middle" />
        </span>
      </h2>
      <ClientRows rows={5} />
    </div>
  );
}

/**
 * The requests card while its own read is pending. The card header and its
 * action stay, and the body draws the rows it will hold.
 */
export function RequestsSectionSkeleton({
  withStatus = true,
}: {
  withStatus?: boolean;
}) {
  return (
    <>
      {withStatus ? (
        <span className="sr-only" role="status">
          Reading your requests
        </span>
      ) : null}
      <SectionCard
        title={<>Requests you raised today{COUNT}</>}
        sub="Each one becomes a ClickUp task on the other team's board, with its SOP steps and an owner."
        action={<Skeleton className="h-4 w-24" />}
        flush
      >
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm sm:px-6"
          >
            <Skeleton className="h-5 w-16 rounded-full" />
            <span className="min-w-0 flex-1">
              <Skeleton className="h-4 w-40" />
            </span>
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </SectionCard>
    </>
  );
}

export function TodaySkeleton() {
  return (
    <div
      aria-hidden="true"
      data-page-skeleton="today"
      className="mx-auto w-full max-w-6xl space-y-6"
    >
      <div data-section="page-header">
        <PageHeader
          title="Today"
          actions={
            <>
              <Skeleton className="h-8 w-28 rounded-lg" />
              <Skeleton className="h-8 w-32 rounded-lg" />
            </>
          }
        >
          <div className="mt-1 text-sm text-muted-foreground">
            <Skeleton className="h-4 w-64" />
          </div>
        </PageHeader>
      </div>

      <div className="text-[15px] leading-6" data-section="today-summary">
        <Skeleton className="h-5 w-3/4" />
      </div>

      <div className="space-y-3" data-section="today-stats">
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          <Stat label="Need you today" />
          <Stat label="New signups" />
          <Stat label="Invoices past due" />
        </div>
        <div className="text-sm">
          <span className="text-muted-foreground">The rest of the numbers</span>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            <Stat label="In onboarding" />
            <Stat label="Managed clients" />
            <Stat label="Hot list" />
            <Stat label="Loose ends" />
          </div>
        </div>
      </div>

      <section className="space-y-8" data-section="who-needs-you">
        <ShortListSkeleton title="Onboarding, get them live" />
        <ShortListSkeleton title="Management, keep them alive" />
      </section>

      <div className="space-y-6">
        <div data-section="commitments">
          <SectionCard
            title={<>Commitments from calls{COUNT}</>}
            sub="Pulled from the 1-1 call notes form. Each one becomes a real task, or you close it."
            flush
          >
            <ChecklistRows rows={5} />
          </SectionCard>
        </div>

        <div data-section="requests">
          <RequestsSectionSkeleton withStatus={false} />
        </div>

        <div data-section="loose-ends">
          <SectionCard
            title={<>Loose ends{COUNT}</>}
            sub="What the board says nobody closed. Anything about money stays; the rest can be written off in one go, and who cleared it is recorded."
            flush
          >
            <ChecklistRows rows={5} />
          </SectionCard>
        </div>

        <div data-section="client-success-board">
          <SectionCard
            title={<>Client Success board{COUNT}</>}
            sub="Due, overdue or undated, in ClickUp."
            flush
          >
            {Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 text-sm sm:px-6"
              >
                <div className="min-w-0 space-y-1.5">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-4 w-10" />
              </div>
            ))}
          </SectionCard>
        </div>
      </div>

      <section className="rounded-2xl border bg-card" data-section="day-plan">
        <h2 className="px-4 pt-4 pb-3 text-[15px] font-semibold sm:px-6 sm:pt-6">
          Day plan
        </h2>
        <div className="divide-y border-t">
          {[
            "1 · Morning sprint",
            "2 · Then the work",
            "3 · Midday sprint",
            "4 · Then the work",
            "5 · Evening sprint",
          ].map(title => (
            <div
              key={title}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 sm:px-6"
            >
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                <Skeleton className="size-3.5 shrink-0 rounded-sm" />
                {title}
              </span>
              <Skeleton className="h-3 w-40" />
            </div>
          ))}
        </div>
      </section>

      <div
        className="group rounded-2xl border bg-card"
        data-section="calendar-fold"
      >
        <div className="no-marker flex flex-wrap items-center gap-2 px-4 py-4 text-[15px] font-semibold sm:px-6">
          <Skeleton className="size-4 shrink-0 rounded-sm" />
          Calendar and data fixes
          <span className="text-xs font-normal text-muted-foreground">
            Google Calendar for the week, and clients missing a sheet, a CRM
            account or a call
          </span>
        </div>
      </div>

      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed px-4 py-4 sm:px-6"
        data-section="today-footer"
      >
        <p className="text-sm text-muted-foreground">
          At 17:30, close the loose ends, then file your end of day. It writes
          itself from what you did today.
        </p>
        <Skeleton className="h-8 w-40 rounded-lg" />
      </div>
    </div>
  );
}
