import {
  ArrowUpRight,
  CalendarDays,
  Dna,
  Film,
  ListChecks,
  MessageSquare,
  PenLine,
  Plus,
  Sparkles,
  Trophy,
} from "lucide-react";
import type { ElementType, ReactNode } from "react";
import { rememberedSkeleton } from "@/components/RememberedSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

export const DASHBOARD_SKELETON_PATHS = ["/dashboard"];

const ROW = "px-4 py-3 text-sm sm:px-6";
const KICKER =
  "font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground";
const CARD = "rounded-2xl border bg-card p-4 sm:p-6";

/** One card with its title row, the same shape the page uses. */
function SectionShell({
  icon: Icon,
  title,
  sub,
  flush = false,
  children,
}: {
  icon: ElementType;
  title: ReactNode;
  sub?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Icon className="size-4 shrink-0 translate-y-0.5 text-muted-foreground" />
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {sub ? (
          <span className="text-xs text-muted-foreground">{sub}</span>
        ) : null}
      </div>
      <div
        className={
          flush ? "-mx-4 -mb-4 mt-4 border-t sm:-mx-6 sm:-mb-6" : "mt-4"
        }
      >
        {children}
      </div>
    </section>
  );
}

function rows(count: number) {
  return Array.from({ length: count }, (_, i) => i);
}

/** The day's own task card: the shared Your tasks card, rows held back. */
function YourTasksSkeleton() {
  return (
    <section
      aria-hidden="true"
      className="overflow-hidden rounded-2xl border bg-card"
    >
      <header className="px-4 pb-3 pt-4 sm:px-6 sm:pt-5">
        <h2 className="text-[15px] font-semibold">Your tasks</h2>
      </header>
      <ul className="divide-y border-t">
        {rows(5).map(i => (
          <li
            key={`task-${i}`}
            className="flex min-h-11 items-center gap-3 px-4 py-2.5 sm:px-6"
          >
            <Skeleton className="h-7 w-0.5 shrink-0 rounded-full" />
            <Skeleton className="h-4 min-w-0 flex-1" />
            <Skeleton className="h-3 w-20 shrink-0" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What clients said on WhatsApp: the header and its waiting threads. */
function WhatsAppSkeleton() {
  return (
    <section aria-hidden="true">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-[15px] font-semibold tracking-tight">WhatsApp</h2>
        <Skeleton className="h-3 w-48 max-w-full" />
      </div>
      <ul className="mt-3 space-y-3">
        {rows(2).map(i => (
          <li key={`thread-${i}`} className="space-y-2 rounded-xl border p-3">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5 max-w-full" />
            <Skeleton className="h-8 w-28" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The fixed shape of the day, ticked off as you go. */
function ChecklistSkeleton({ title }: { title: string }) {
  return (
    <SectionShell
      icon={ListChecks}
      title={title}
      sub={<Skeleton className="h-3 w-12" />}
      flush
    >
      <ul className="divide-y">
        {rows(5).map(i => (
          <li key={`check-${i}`} className={`${ROW} flex items-start gap-3`}>
            <Skeleton className="mt-0.5 size-4 shrink-0 rounded" />
            <span className="min-w-0 flex-1">
              <Skeleton className="h-4 w-48 max-w-full" />
              <Skeleton className="mt-1 h-3 w-64 max-w-full" />
            </span>
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}

/** The scripting calendar as Today shows it: header, planner, queue, week. */
export function CalendarSectionSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-6">
      <div
        data-section="calendar-header"
        className="flex flex-wrap items-baseline gap-x-2 gap-y-1"
      >
        <CalendarDays className="size-4 shrink-0 translate-y-0.5 text-muted-foreground" />
        <h2 className="text-[15px] font-semibold">Scripting calendar</h2>
        <Skeleton className="h-3 w-72 max-w-full" />
      </div>

      <section data-section="plan-script" className={CARD}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Plus className="size-4 shrink-0 translate-y-0.5 text-muted-foreground" />
          <h2 className="text-[15px] font-semibold">Plan a script</h2>
          <span className="text-xs text-muted-foreground">
            Creates the task on the creative board, tagged to the client
          </span>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)]">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
        <Skeleton className="mt-2 min-h-[64px] w-full" />
        <Skeleton className="mt-3 h-9 w-40" />
      </section>

      <section
        data-section="script-queue"
        className={`${CARD} overflow-hidden`}
      >
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Sparkles className="size-4 shrink-0 translate-y-0.5 text-muted-foreground" />
          <h2 className="text-[15px] font-semibold">What to script next</h2>
          <Skeleton className="h-3 w-56 max-w-full" />
        </div>
        <div className="-mx-4 -mb-4 mt-4 divide-y border-t sm:-mx-6 sm:-mb-6">
          {rows(5).map(i => (
            <div
              key={`queue-${i}`}
              className={`${ROW} flex items-center gap-3`}
            >
              <Skeleton className="h-4 min-w-0 flex-1" />
              <Skeleton className="h-8 w-20 shrink-0" />
            </div>
          ))}
        </div>
      </section>

      <div
        data-section="calendar-filter"
        className="flex flex-wrap items-center gap-2 text-sm"
      >
        <span className="text-muted-foreground">Show</span>
        <Skeleton className="h-8 w-40" />
      </div>

      <div
        data-section="calendar-grid"
        className="grid gap-2 md:grid-cols-4 lg:grid-cols-7"
      >
        {rows(7).map(i => (
          <div
            key={`day-${i}`}
            className="rounded-xl border bg-card p-2 md:min-h-[96px]"
          >
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="space-y-1.5">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </div>
        ))}
      </div>

      <section data-section="undated" className={CARD}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <CalendarDays className="size-4 shrink-0 translate-y-0.5 text-muted-foreground" />
          <h2 className="text-[15px] font-semibold">No date on them yet</h2>
          <span className="text-xs text-muted-foreground">
            Open work that never appears on a day until it gets one
          </span>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-3">
          {rows(3).map(i => (
            <Skeleton key={`undated-${i}`} className="h-16 w-full" />
          ))}
        </div>
      </section>

      <div
        data-section="drive-folders"
        className="overflow-hidden rounded-2xl border bg-card"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-3 sm:px-6">
          <span className="text-[15px] font-semibold">
            Client Drive folders
          </span>
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
      </div>
    </div>
  );
}

/** What the live ad accounts say to make more of, held back. */
export function CreativePerformanceSectionSkeleton() {
  return (
    <section
      aria-hidden="true"
      data-section="creative-performance"
      className="overflow-hidden rounded-2xl border bg-card p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Trophy className="size-4 shrink-0 translate-y-0.5 text-muted-foreground" />
        <h2 className="text-[15px] font-semibold">What to make more of</h2>
        <span className="text-xs text-muted-foreground">
          From the live ad accounts
        </span>
      </div>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <div>
          <h3 className={`mb-2 ${KICKER}`}>Winning creatives</h3>
          <ul className="divide-y rounded-xl bg-muted/40">
            {rows(5).map(i => (
              <li key={`winner-${i}`} className="px-3 py-2.5 text-sm">
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="mt-1 h-3 w-56 max-w-full" />
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className={`mb-2 ${KICKER}`}>Frequency watch</h3>
          <ul className="divide-y rounded-xl bg-muted/40">
            {rows(5).map(i => (
              <li key={`frequency-${i}`} className="px-3 py-2.5 text-sm">
                <Skeleton className="h-4 w-36 max-w-full" />
                <Skeleton className="mt-1 h-3 w-48 max-w-full" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/**
 * Today, with its data held back. It is the loaded page in the same order:
 * the header, the parts strip, the morning, scripting, videos and
 * touchpoints, so nothing moves when the snapshot arrives.
 */
function DashboardSkeletonStatic() {
  return (
    <div
      aria-hidden="true"
      data-page-skeleton="dashboard"
      className="mx-auto w-full max-w-6xl space-y-6"
    >
      <header
        data-section="page-header"
        className="mb-6 flex flex-wrap items-end justify-between gap-3"
      >
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9">
            Today
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <Skeleton className="h-4 w-72 max-w-full" />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-[8.75rem]" />
          <Skeleton className="h-8 w-[6.75rem]" />
          <Skeleton className="h-8 w-32" />
        </div>
      </header>

      <nav
        aria-label="On this page"
        data-section="on-this-page"
        className="-mt-2 flex flex-wrap gap-1.5"
      >
        {["Morning", "Scripting", "Videos", "Touchpoints"].map(label => (
          <span
            key={label}
            className="rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            {label}
          </span>
        ))}
      </nav>

      <div data-section="morning" className="scroll-mt-20 space-y-6">
        <YourTasksSkeleton />
        <WhatsAppSkeleton />
        <ChecklistSkeleton title="Before you produce anything" />
      </div>

      <div data-section="scripting" className="scroll-mt-20 space-y-6">
        <ChecklistSkeleton title="The sweep" />
        <CalendarSectionSkeleton />
        <SectionShell
          icon={Dna}
          title="Brand DNA board rows"
          sub="The doc is what counts, not the task. Rows marked done are already written and can be closed"
          flush
        >
          <ul className="divide-y">
            {rows(6).map(i => (
              <li
                key={`brand-${i}`}
                className={`${ROW} flex items-center gap-3`}
              >
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                  <Skeleton className="h-4 w-40 max-w-full" />
                  <Skeleton className="h-5 w-32 rounded-full" />
                  <Skeleton className="h-3 w-20 sm:ml-auto" />
                </span>
                <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
              </li>
            ))}
          </ul>
        </SectionShell>
        <SectionShell
          icon={PenLine}
          title="Script requests"
          sub={<Skeleton className="h-3 w-32" />}
          flush
        >
          <ul className="divide-y">
            {rows(6).map(i => (
              <li
                key={`script-${i}`}
                className={`${ROW} flex items-center gap-3`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Skeleton className="h-4 w-36 max-w-full" />
                    <Skeleton className="h-3 w-20 sm:ml-auto" />
                  </span>
                  <Skeleton className="mt-1 h-3 w-2/3 max-w-full" />
                </span>
                <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
              </li>
            ))}
          </ul>
        </SectionShell>
      </div>

      <div data-section="videos" className="scroll-mt-20 space-y-6">
        <SectionShell
          icon={Film}
          title="Video pipeline"
          sub={<Skeleton className="h-3 w-32" />}
        >
          <div className="flex flex-wrap gap-1.5">
            {rows(5).map(i => (
              <Skeleton key={`stage-${i}`} className="h-6 w-24 rounded-full" />
            ))}
          </div>
          <ul className="-mx-4 -mb-4 mt-4 divide-y border-t sm:-mx-6 sm:-mb-6">
            {rows(5).map(i => (
              <li
                key={`pipeline-${i}`}
                className={`${ROW} flex items-center gap-3`}
              >
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-4 w-40 max-w-full" />
                  <Skeleton className="h-3 w-24 sm:ml-auto" />
                </span>
                <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
              </li>
            ))}
          </ul>
        </SectionShell>
        <SectionShell icon={Film} title="Editors" sub="Who owes what" flush>
          <ul className="divide-y">
            {rows(5).map(i => (
              <li
                key={`editor-${i}`}
                className={`${ROW} flex flex-wrap items-center gap-x-3 gap-y-1`}
              >
                <Skeleton className="h-4 w-32 max-w-full" />
                <Skeleton className="h-3 w-32 sm:ml-auto" />
              </li>
            ))}
          </ul>
        </SectionShell>
      </div>

      <div data-section="touchpoints" className="scroll-mt-20 space-y-6">
        <SectionShell
          icon={MessageSquare}
          title="The rule"
          sub="Creative director floor, lighter than the CSM's"
        >
          <p className="text-sm">
            <strong className="font-semibold">
              1 to 2 messages a week in the client's group per active client.
            </strong>{" "}
            A touchpoint gives them something, a script going out, a video to
            review, a creative refresh, an answer. "Just checking in" does not
            count, and a real concern gets a call, not a text.
          </p>
          <Skeleton className="mt-2 h-4 w-64 max-w-full" />
        </SectionShell>
        <SectionShell
          icon={MessageSquare}
          title={<Skeleton className="h-4 w-48 max-w-full" />}
          flush
        >
          <ul className="divide-y">
            {rows(5).map(i => (
              <li key={`touch-${i}`} className={ROW}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <Skeleton className="h-4 w-40 max-w-full" />
                  <span className="flex items-center gap-2 sm:ml-auto">
                    <Skeleton className="h-8 w-28" />
                    <Skeleton className="h-8 w-20" />
                  </span>
                </div>
                <div className="mt-1.5 space-y-1">
                  <Skeleton className="h-3 w-2/3 max-w-full" />
                  <Skeleton className="h-3 w-1/2 max-w-full" />
                </div>
              </li>
            ))}
          </ul>
        </SectionShell>
        <SectionShell
          icon={MessageSquare}
          title="Every template in the SOP"
          sub="For a message that is not on the list above"
        >
          <Skeleton className="h-8 w-56 max-w-full" />
        </SectionShell>
      </div>
    </div>
  );
}

export const DashboardSkeleton = rememberedSkeleton(
  "dashboard",
  DashboardSkeletonStatic,
);
