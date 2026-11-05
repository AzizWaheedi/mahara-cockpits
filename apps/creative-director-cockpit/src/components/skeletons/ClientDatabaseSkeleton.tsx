import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The client database while it loads.
 *
 * This is the loaded page with the data held back: the same header, the same
 * two views and rows of the same height, so nothing moves when the roster
 * arrives.
 */

export const CLIENTS_SKELETON_PATHS: string[] = ["/clients"];

const VIEWS = ["All clients", "Worst first"];

const TAB_BASE =
  "rounded-full border px-3 py-1 text-xs font-medium transition-colors";
const TAB_ACTIVE = "border-primary/50 bg-primary/10 text-foreground";
const TAB_IDLE =
  "text-muted-foreground hover:border-primary/40 hover:text-foreground";

function ClientRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 text-sm">
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-center gap-2">
          <Skeleton className="h-5 w-40 max-w-full" />
          <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
        </span>
        <span className="flex basis-full flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground sm:ml-auto sm:basis-auto">
          <Skeleton className="h-3.5 w-12" />
          <Skeleton className="h-3.5 w-14" />
        </span>
      </span>
      <Skeleton className="size-4 shrink-0" />
    </div>
  );
}

export function ClientDatabaseSkeleton() {
  return (
    <div
      aria-hidden="true"
      data-page-skeleton="clients"
      className="mx-auto w-full max-w-6xl"
    >
      <div data-section="page-header">
        <PageHeader
          title="Clients"
          sub={<Skeleton className="mt-1 h-5 w-56 max-w-full" />}
          actions={
            <>
              <Skeleton className="h-8 w-48 rounded-md" />
              <Skeleton className="h-8 w-full rounded-md sm:w-80" />
            </>
          }
        />
      </div>

      <nav
        data-section="view-switcher"
        className="-mt-2 mb-4 flex gap-1.5"
        aria-label="Show the clients"
      >
        {VIEWS.map((label, i) => (
          <span
            key={label}
            className={`${TAB_BASE} ${i === 0 ? TAB_ACTIVE : TAB_IDLE}`}
          >
            {label}
          </span>
        ))}
      </nav>

      <div
        data-section="client-list"
        className="divide-y overflow-hidden rounded-xl border"
      >
        {[0, 1, 2, 3, 4].map(i => (
          <ClientRow key={i} />
        ))}
      </div>
    </div>
  );
}

/* The scripting database. */

const ABOUT =
  "Ads found by the weekly check spent at least $100 at $15 or less a lead. Ads marked Saved were picked by the team, with their numbers from the day they were saved. Click one to read its hook, its copy and, for video, what is actually said and shown on screen.";

const WINNER_CHIPS = ["All", "Saved by the team", "Found by the weekly check"];

const FILTERBASE =
  "no-touch relative h-8 shrink-0 whitespace-nowrap rounded-full px-3 text-xs font-medium transition-colors after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']";
const FILTER_ACTIVE =
  "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40";
const FILTER_IDLE =
  "text-muted-foreground hover:bg-muted hover:text-foreground";
const FILTER_ROW =
  "-mx-4 flex flex-nowrap items-center gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden";

function ScriptRow() {
  return (
    <div className="flex items-start gap-3 px-3 py-3 sm:items-center">
      <Skeleton className="size-10 shrink-0 rounded-md" />
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="hidden w-14 shrink-0 text-sm font-semibold tabular-nums sm:block">
          <Skeleton className="h-5 w-14" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Skeleton className="h-5 w-32 max-w-full" />
          </span>
          <Skeleton className="mt-1 h-4 w-3/4 max-w-full" />
        </span>
        <span className="basis-full text-xs text-muted-foreground sm:basis-auto sm:text-right">
          <Skeleton className="h-4 w-16 sm:hidden" />
          <Skeleton className="h-4 w-40 max-w-full sm:ml-auto" />
          <Skeleton className="mt-1 h-3 w-24 max-w-full sm:ml-auto" />
        </span>
      </div>
      <Skeleton className="h-8 w-20 shrink-0 rounded-md" />
    </div>
  );
}

export function ScriptDatabaseSkeleton() {
  return (
    <div
      aria-hidden="true"
      data-page-skeleton="scripting-database"
      className="mx-auto w-full max-w-6xl"
    >
      <div data-section="page-header">
        <PageHeader
          title="Scripting database"
          sub={<Skeleton className="mt-1 h-5 w-64 max-w-full" />}
        />
      </div>

      <p
        data-section="intro"
        className="-mt-3 mb-6 text-xs text-muted-foreground"
      >
        Before you write anything, read what already worked in the same service
        line. Search the actual copy and transcripts, not just the ad names.
      </p>

      <div
        data-section="filters"
        className="mb-3 flex flex-wrap items-center gap-2"
      >
        <Skeleton className="h-8 w-40 rounded-md" />
        <span className="flex h-8 items-center gap-2 text-sm text-muted-foreground">
          <Skeleton className="size-4 shrink-0" />
          Only ads still live
        </span>
        <div className="flex basis-full sm:ml-auto sm:basis-80">
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
      </div>

      <div data-section="filter-chips" className="mb-3">
        <div className={FILTER_ROW}>
          {WINNER_CHIPS.map((label, i) => (
            <span
              key={label}
              className={`${FILTERBASE} ${i === 0 ? FILTER_ACTIVE : FILTER_IDLE}`}
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      <div data-section="scripting-table">
        <details className="mb-3 text-xs text-muted-foreground">
          <summary className="w-fit">About this list</summary>
          <p className="mt-1">{ABOUT}</p>
        </details>
        <div className="divide-y rounded-xl border">
          {[0, 1, 2, 3, 4].map(i => (
            <ScriptRow key={i} />
          ))}
        </div>
      </div>

      <section data-section="client-links" className="mt-8">
        <h2 className="text-[15px] font-semibold">Or start from a client</h2>
        <p className="mt-1 mb-3 text-xs text-muted-foreground">
          Opens their full screen: brand direction, offer, everything we have
          made and what is live on their account right now.
        </p>
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <Skeleton key={i} className="h-8 w-28 rounded-full" />
          ))}
        </div>
      </section>
    </div>
  );
}
