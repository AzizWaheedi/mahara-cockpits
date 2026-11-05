import type { ReactNode } from "react";
import { Kicker } from "@/components/ceo/Kicker";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** The CEO page this skeleton stands for. */
export const CEO_SKELETON_PATHS: string[] = ["/ceo"];

const LINE = "block rounded bg-muted motion-safe:animate-pulse";

/** One line of text, held back. A span, so it can sit inside a p, h1 or h2. */
function Line({ className }: { className?: string }) {
  return <span aria-hidden className={cn(LINE, className)} />;
}

/**
 * The SectionCard shell (src/components/ceo/SectionCard.tsx): the same card,
 * header and body wrappers, with the body held back. The live card fades in
 * with framer-motion, so this copy draws the same box without the motion and
 * without the stale banners.
 */
function CardSkeleton({
  kicker,
  kickerBlock,
  title,
  titleBlock,
  action = true,
  children,
}: {
  /** A kicker that never depends on data. */
  kicker?: string;
  /** True when the kicker names the chosen timeframe. */
  kickerBlock?: boolean;
  /** A title that never depends on data. */
  title?: string;
  /** True when the title depends on the payload. */
  titleBlock?: boolean;
  /** Draw the quiet tab link in the header. */
  action?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="ceo-card min-w-0 rounded-2xl border bg-card p-4 text-card-foreground sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          {kicker ? <Kicker className="mb-1.5">{kicker}</Kicker> : null}
          {kickerBlock ? (
            <Kicker className="mb-1.5">
              <Line className="h-3 w-20" />
            </Kicker>
          ) : null}
          <h2 className="text-[15px] font-semibold leading-5 text-foreground">
            {titleBlock ? <Line className="h-5 w-44" /> : title}
          </h2>
        </div>
        {action ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Skeleton className="h-6 w-16 rounded-md" />
          </div>
        ) : null}
      </header>
      <div className="@container mt-4 min-w-0">{children}</div>
    </section>
  );
}

/** One StatTile (variant plain): the label stays, its number and lines wait. */
function StatTileSkeleton({ label }: { label: string }) {
  return (
    <div className="relative flex min-w-0 flex-col text-left">
      <div className="flex min-w-0 items-start gap-1 text-xs leading-5 text-muted-foreground">
        <span className="line-clamp-2 min-w-0">{label}</span>
      </div>
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="whitespace-nowrap text-2xl font-semibold leading-8 tracking-tight tabular-nums text-foreground">
          <Line className="h-8 w-20" />
        </div>
      </div>
      <div className="mt-1 flex min-w-0 flex-col gap-0.5">
        <Line className="h-3 w-24" />
        <Line className="h-3 w-32" />
      </div>
    </div>
  );
}

/** The timeframe bar: the note stays, the days, the comparison and the picker wait. */
function TimeframeSkeleton() {
  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <p className="text-sm text-muted-foreground tabular-nums">
        <Line className="h-4 w-40" />
        <span className="mt-1 block text-xs">
          Cash, deals, refunds, cost per lead, both funnels, delivery by client
          and EODs follow these days. Yesterday&apos;s and today&apos;s tiles
          are single days; speed to lead is the last 7 days.
        </span>
      </p>
      <div className="shrink-0">
        <Skeleton className="h-7 w-40 rounded-md" />
      </div>
    </div>
  );
}

/** The cash hero body: the figure, the chart, the meter and the three rows. */
function CashBodySkeleton() {
  return (
    <div className="grid gap-6 @4xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] @4xl:gap-10">
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">
          <Line className="h-4 w-52" />
        </p>
        <p className="mt-1 text-5xl font-semibold leading-none tracking-tight text-foreground sm:text-[56px]">
          <Line className="h-12 w-64 sm:h-14" />
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <Line className="h-4 w-56" />
        </div>
        <div className="mt-6">
          <Skeleton className="h-[72px] w-full" />
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <Line className="h-3 w-40" />
            <Line className="h-3 w-44" />
          </div>
        </div>
      </div>

      <div className="min-w-0 @4xl:border-l @4xl:pl-10">
        <div className="mb-5 border-b pb-5">
          <div className="flex items-baseline justify-between gap-3">
            <Line className="h-3 w-48" />
            <Line className="h-3 w-10" />
          </div>
          <Line className="mt-1 h-6 w-32" />
          <Skeleton className="mt-2.5 h-2 w-full rounded-full" />
          <Line className="mt-2 h-3 w-56" />
        </div>
        <dl>
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-[color:var(--ceo-grid)] py-3 first:pt-0 last:border-0 last:pb-0"
            >
              <dt className="col-start-1 row-start-1 text-xs text-muted-foreground">
                <Line className="h-3 w-28" />
              </dt>
              <dd className="col-start-2 row-span-2 row-start-1 text-xl font-semibold tracking-tight text-foreground">
                <Line className="h-6 w-20" />
              </dd>
              <dd className="col-start-1 row-start-2 mt-0.5 text-xs text-muted-foreground">
                <Line className="h-3 w-40" />
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/** The six numbers in one card. Their labels never change, so they stay. */
const KPI_LABELS = [
  "Client ad spend yesterday",
  "Client Meta form leads yesterday",
  "Client cost per lead",
  "Client bookings made yesterday",
  "Dials today",
  "Speed to lead, 7 days",
];

/** The KPI card body. */
function KpiBodySkeleton() {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-6 @2xl:grid-cols-3 @5xl:grid-cols-6">
      {KPI_LABELS.map(label => (
        <StatTileSkeleton key={label} label={label} />
      ))}
    </div>
  );
}

/** One funnel strip: the step names stay, the bars and figures wait. */
function FunnelSkeleton({
  steps,
  context,
}: {
  /** The step names, in funnel order. */
  steps: string[];
  /** How many figures sit above the bars. */
  context: number;
}) {
  return (
    <div className="@container min-w-0">
      <dl className="mb-4 flex flex-wrap gap-x-6 gap-y-2">
        {Array.from({ length: context }, (_, i) => (
          <div key={i} className="min-w-0">
            <dt className="text-xs text-muted-foreground">
              <Line className="h-3 w-24" />
            </dt>
            <dd className="text-base font-semibold tracking-tight text-foreground">
              <Line className="mt-0.5 h-5 w-20" />
            </dd>
          </div>
        ))}
      </dl>
      <ol>
        {steps.map((step, i) => (
          <li key={step} className="min-w-0">
            {i > 0 ? (
              <div className="flex h-7 min-w-0 items-center gap-1.5 text-xs @sm:pl-[9.25rem]">
                <Skeleton className="h-3 w-10" />
                <Skeleton className="h-3 w-16" />
              </div>
            ) : null}
            <div className="grid min-w-0 items-center gap-x-3 gap-y-1 @sm:grid-cols-[8.5rem_minmax(0,1fr)]">
              <span className="min-w-0 truncate text-sm text-foreground">
                {step}
              </span>
              <div className="flex h-6 min-w-0 items-center gap-2">
                <Skeleton className="h-[18px] w-1/3 rounded-r-[4px]" />
                <Skeleton className="h-4 w-10" />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Five rows of clients at risk, drawn as the loaded list draws them. */
function ClientsBodySkeleton() {
  return (
    <>
      <p className="text-xs text-muted-foreground">
        <Line className="h-3 w-64" />
      </p>
      <ul className="mt-3">
        {[0, 1, 2, 3, 4].map(i => (
          <li
            key={i}
            className="border-b border-[color:var(--ceo-grid)] py-3 first:pt-0 last:border-0 last:pb-0"
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  <Line className="h-4 w-40" />
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  <Line className="h-3 w-48" />
                </p>
              </div>
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
            <p className="mt-2 flex min-w-0 gap-1.5 text-xs leading-5 text-muted-foreground">
              <Line className="mt-[3px] size-3.5 shrink-0 rounded-full" />
              <Line className="h-3 w-full max-w-sm" />
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The table headers never change, so they stay; the rows wait. */
const DELIVERY_HEADERS = [
  { label: "Client", numeric: false, hide: "" },
  { label: "Spend", numeric: true, hide: "" },
  { label: "Meta leads", numeric: true, hide: "hidden @md:table-cell" },
  { label: "Meta CPL", numeric: true, hide: "" },
  {
    label: "Confirmed bookings",
    numeric: true,
    hide: "hidden @md:table-cell",
  },
];

/** Six rows of clients by spend. */
function DeliveryBodySkeleton() {
  return (
    <>
      <div className="@container min-w-0">
        <div className="ceo-table-scroll relative -mx-4 overflow-x-auto sm:-mx-6">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b">
                {DELIVERY_HEADERS.map(h => (
                  <th
                    key={h.label}
                    scope="col"
                    className={cn(
                      "h-9 whitespace-nowrap px-3 text-xs font-medium text-muted-foreground first:pl-4 last:pr-4 sm:first:pl-6 sm:last:pr-6",
                      h.numeric ? "text-right" : "text-left",
                      h.label === "Client" && "w-full max-w-0",
                      h.hide,
                    )}
                  >
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3, 4, 5].map(i => (
                <tr
                  key={i}
                  className="border-b border-[color:var(--ceo-grid)] last:border-0"
                >
                  <td className="w-full max-w-0 px-3 py-2.5 text-left first:pl-4 last:pr-4 sm:first:pl-6 sm:last:pr-6">
                    <span className="flex min-w-0 items-center gap-2">
                      <Line className="size-3.5 shrink-0 rounded-full" />
                      <Line className="h-4 w-32" />
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums first:pl-4 last:pr-4 sm:first:pl-6 sm:last:pr-6">
                    <Skeleton className="ml-auto h-4 w-14" />
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums first:pl-4 last:pr-4 @md:table-cell sm:first:pl-6 sm:last:pr-6">
                    <Skeleton className="ml-auto h-4 w-10" />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums first:pl-4 last:pr-4 sm:first:pl-6 sm:last:pr-6">
                    <Skeleton className="ml-auto h-4 w-14" />
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums first:pl-4 last:pr-4 @md:table-cell sm:first:pl-6 sm:last:pr-6">
                    <Skeleton className="ml-auto h-4 w-10" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {[0, 1, 2, 3].map(i => (
            <li key={i} className="inline-flex items-center gap-1">
              <Skeleton className="size-3 shrink-0 rounded-full" />
              <Line className="h-3 w-16" />
            </li>
          ))}
        </ul>
        <Line className="h-3 w-32" />
      </div>
    </>
  );
}

/** Five rows of team activity. */
function FeedBodySkeleton() {
  return (
    <ol className="min-w-0">
      {[0, 1, 2, 3, 4].map(i => (
        <li
          key={i}
          className="flex min-w-0 gap-3 border-b border-[color:var(--ceo-grid)] py-2.5 first:pt-0 last:border-0 last:pb-0"
        >
          <Skeleton className="mt-0.5 size-7 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[13px] leading-5 text-foreground">
              <Line className="h-4 w-full max-w-md" />
            </p>
            <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              <Line className="h-3 w-24" />
              <Line className="h-3 w-16" />
            </p>
          </div>
          <Line className="h-3 w-10 shrink-0" />
        </li>
      ))}
    </ol>
  );
}

/** Five rows of people with their EOD state. */
function TeamBodySkeleton() {
  return (
    <>
      <p className="text-xs text-muted-foreground">
        <Line className="h-3 w-56" />
      </p>
      <ul className="mt-3">
        {[0, 1, 2, 3, 4].map(i => (
          <li
            key={i}
            className="flex min-w-0 items-start justify-between gap-3 border-b border-[color:var(--ceo-grid)] py-2.5 first:pt-0 last:border-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                <Line className="h-4 w-32" />
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                <Line className="h-3 w-48" />
              </p>
            </div>
            <Skeleton className="h-5 w-24 rounded-full" />
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Your tasks, the card every Today carries: five rows at most. Exported so
 * the card's own reading state can draw the same box once the shared file
 * (src/components/tasks/YourTasks.tsx) takes it.
 */
export function YourTasksCardSkeleton() {
  return (
    <section className="tk-card">
      <header className="tk-card-head">
        <h2 className="tk-card-title">
          Your tasks
          <Line className="h-4 w-6 rounded-full" />
        </h2>
      </header>
      <ul className="tk-list">
        {[0, 1, 2, 3, 4].map(i => (
          <li key={i}>
            <div className="tk-row">
              <Line className="h-4 w-2/5" />
              <Line className="h-3 w-24" />
              <Line className="h-3 w-16" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The Today tab with its data held back: the same grid, the same cards, the
 * same rows, so nothing moves when the sections arrive. The machine line is
 * left out: it only shows when something is failing.
 */
export function CeoTodayTabSkeleton() {
  return (
    <div className="@container grid gap-4 lg:gap-6">
      <div data-section="today-timeframe" className="min-w-0">
        <TimeframeSkeleton />
      </div>

      <div data-section="today-cash" className="min-w-0">
        <CardSkeleton titleBlock>
          <CashBodySkeleton />
        </CardSkeleton>
      </div>

      <div data-section="today-kpis" className="min-w-0">
        <CardSkeleton
          kicker="Yesterday and today"
          title="Client delivery and calls"
        >
          <KpiBodySkeleton />
        </CardSkeleton>
      </div>

      <YourTasksCardSkeleton />

      <div
        data-section="today-funnels"
        className="grid items-start gap-4 lg:gap-6 @4xl:grid-cols-2"
      >
        <CardSkeleton kickerBlock title="Client delivery funnel">
          <FunnelSkeleton
            steps={[
              "Meta form leads",
              "Actual calls",
              "Connected",
              "Confirmed bookings",
            ]}
            context={3}
          />
        </CardSkeleton>
        <CardSkeleton kickerBlock title="Mahara growth funnel">
          <FunnelSkeleton
            steps={[
              "Leads",
              "Intros booked",
              "Demos booked",
              "Demos shown",
              "Closes",
            ]}
            context={4}
          />
        </CardSkeleton>
      </div>

      <div
        data-section="today-columns"
        className="grid items-start gap-4 lg:gap-6 @4xl:grid-cols-2"
      >
        <div
          data-section="today-clients"
          className="grid min-w-0 gap-4 lg:gap-6"
        >
          <CardSkeleton kicker="Right now" title="Clients that need you">
            <ClientsBodySkeleton />
          </CardSkeleton>
          <CardSkeleton kickerBlock title="Delivery by client">
            <DeliveryBodySkeleton />
          </CardSkeleton>
        </div>
        <div data-section="today-team" className="grid min-w-0 gap-4 lg:gap-6">
          <CardSkeleton kicker="Newest first" title="Live feed">
            <FeedBodySkeleton />
          </CardSkeleton>
          <CardSkeleton title="Team today" action={false}>
            <TeamBodySkeleton />
          </CardSkeleton>
        </div>
      </div>
    </div>
  );
}

/**
 * The CEO page while its sections read: the header and the Today tab, with
 * the date, the title, the trust pill, Refresh and the one-sentence line held
 * back. The live page draws the same header, so nothing moves on arrival.
 */
export function CeoSkeleton() {
  return (
    <div
      aria-hidden="true"
      data-page-skeleton="ceo"
      className="ceo-root mx-auto w-full min-w-0 max-w-[1440px]"
    >
      <header className="pb-6" data-section="header">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-[8.75rem] max-w-[65%] shrink-0">
            <p className="whitespace-nowrap text-xs text-muted-foreground sm:text-sm">
              <Line className="h-4 w-24" />
            </p>
            <h1 className="mt-0.5 truncate text-2xl font-semibold tracking-tight text-foreground sm:text-[28px] sm:leading-9">
              <Line className="h-8 w-40 sm:h-9" />
            </h1>
          </div>
          <div className="flex min-w-0 items-center gap-2 pb-0.5">
            <Skeleton className="h-8 w-28 rounded-full" />
            <Skeleton className="size-10 rounded-full sm:h-9 sm:w-24" />
          </div>
        </div>
        <p className="mt-2 min-h-5 max-w-3xl text-sm text-muted-foreground sm:text-[15px]">
          <Line className="h-4 w-72 max-w-full" />
        </p>
      </header>

      <div className="min-w-0 pb-10" data-section="today">
        <CeoTodayTabSkeleton />
      </div>
    </div>
  );
}
