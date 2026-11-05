/**
 * The Jobs home with its data held back: the list the desk opens on, and
 * the board at ?view=board. Every block is the size of the thing it stands
 * for, so the page does not move when the jobs arrive. Decorative only.
 */

/** The route paths these skeletons stand for. */
export const JOBS_SKELETON_PATHS = ["/"];

function Block({ className = "" }: { className?: string }) {
  return (
    <div
      className={`min-w-0 max-w-full rounded-[var(--radius-md)] bg-muted motion-safe:animate-pulse ${className}`}
    />
  );
}

/**
 * The page header. The title is fixed, so it stays real text; the synced
 * line and every control are the data's, so they are blocks.
 */
function HeaderSkeleton({ board = false }: { board?: boolean }) {
  return (
    <header
      data-section="jobs-header"
      className="mb-6 flex flex-wrap items-end justify-between gap-3"
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <Block className="h-4 w-64" />
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          <Block className="h-8 w-20 shrink-0 rounded-full" />
          <Block className="h-8 w-24 shrink-0 rounded-full" />
        </div>
        <Block className="h-8 w-32 rounded-lg" />
        {board ? (
          <Legend />
        ) : (
          <>
            <Block className="h-8 w-28 rounded-lg" />
            <Block className="h-8 w-32 rounded-lg" />
          </>
        )}
      </div>
    </header>
  );
}

/** The two dots the board explains in its header: fixed words, real. */
function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-2" aria-label="Legend">
      {[
        { label: "Ready to start", tone: "var(--success)" },
        { label: "Waiting on someone", tone: "var(--warning)" },
      ].map(d => (
        <li
          key={d.label}
          className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground"
        >
          <span
            aria-hidden
            className="size-1.5 rounded-full"
            style={{ background: d.tone }}
          />
          {d.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * The day in four numbers: labels stay, values are blocks. The page skeleton
 * and the live page both draw this, so the count cards keep one shape.
 */
export function JobsTallySkeleton() {
  return (
    <div data-section="jobs-tally">
      <div className="grid grid-cols-4 gap-2 sm:gap-4">
        {["Ready", "Waiting", "Late", "Due today"].map(label => (
          <div key={label} className="min-w-0 rounded-2xl border bg-card p-4">
            <div className="truncate text-xs text-muted-foreground">
              {label}
            </div>
            <Block className="mt-1 h-8 w-12" />
          </div>
        ))}
      </div>
      <p className="mt-2 mb-6 px-1 text-xs text-muted-foreground">
        These count jobs on you: new, planning, in progress and update required.
        <Block className="ml-1 inline-block h-3 w-40 align-middle" />
      </p>
    </div>
  );
}

/**
 * The Your tasks card while its own read is pending. The loaded card lists
 * five rows before See all, so the same five rows keep its height.
 */
export function YourTasksSkeleton() {
  return (
    <section className="tk-card">
      <header className="tk-card-head">
        <h2 className="tk-card-title">Your tasks</h2>
      </header>
      <ul className="tk-list">
        {[0, 1, 2, 3, 4].map(row => (
          <li key={`task-${row}`}>
            <div className="tk-row">
              <span className="tk-spine" aria-hidden />
              <span className="tk-row-title">
                <Block className="h-4 w-3/4" />
              </span>
              <span className="tk-row-client">
                <Block className="h-3 w-24" />
              </span>
              <span className="tk-row-due">
                <Block className="h-3 w-12" />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One job row: the same height and padding as a loaded row. */
function JobRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <Block className="h-4 w-32" />
          <Block className="h-3 w-14" />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Block className="h-3 w-24" />
          <Block className="h-3 w-20" />
          <Block className="h-3 w-16" />
        </div>
      </div>
      <Block className="size-4 shrink-0" />
    </div>
  );
}

/** One list group: its fixed title and hint, a count and two rows. */
function GroupSkeleton({ title, hint }: { title: string; hint: string }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2 px-1">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        <Block className="h-3 w-4" />
        <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
          {hint}
        </span>
      </div>
      <div className="divide-y overflow-hidden rounded-2xl border bg-card">
        <JobRowSkeleton />
        <JobRowSkeleton />
      </div>
    </section>
  );
}

const LIST_GROUPS = [
  { title: "Ready to start", hint: "Footage read, nothing missing" },
  {
    title: "Waiting on something",
    hint: "These need someone else first",
  },
  {
    title: "In review",
    hint: "With the reviewer or the client until it comes back",
  },
];

/**
 * The list groups while the read is pending: the same stack of sections the
 * loaded page draws below the filters.
 */
export function JobsGroupsSkeleton() {
  return (
    <div aria-hidden="true" data-section="jobs-groups" className="space-y-6">
      {LIST_GROUPS.map(group => (
        <GroupSkeleton
          key={group.title}
          title={group.title}
          hint={group.hint}
        />
      ))}
    </div>
  );
}

/** One board card: its client line, editor and date, at the loaded size. */
function BoardCardSkeleton() {
  return (
    <div className="block rounded-xl border bg-card p-3">
      <div className="flex items-start gap-2">
        <Block className="h-4 w-32 flex-1" />
        <Block className="mt-1.5 size-1.5 shrink-0 rounded-full" />
      </div>
      <Block className="mt-1 h-3 w-24" />
      <Block className="mt-0.5 h-3 w-28" />
    </div>
  );
}

/** The board column: a fixed-status title placeholder, a count and cards. */
function BoardColumnSkeleton() {
  return (
    <section className="w-64 shrink-0">
      <div className="mb-2 flex items-baseline gap-2 px-1">
        <Block className="h-4 w-28" />
        <Block className="h-3 w-4" />
      </div>
      <div className="space-y-2 rounded-2xl bg-muted/40 p-2">
        <BoardCardSkeleton />
        <BoardCardSkeleton />
      </div>
    </section>
  );
}

/** The Jobs list, the desk's home, with its data held back. */
export function JobsSkeleton() {
  return (
    <div
      aria-hidden="true"
      data-page-skeleton="jobs"
      className="mx-auto w-full max-w-6xl"
    >
      <HeaderSkeleton />
      <JobsTallySkeleton />
      <div data-section="your-tasks" className="mb-6">
        <YourTasksSkeleton />
      </div>
      <div
        data-section="jobs-filters"
        className="-mx-4 mb-6 flex flex-nowrap items-center gap-2 overflow-x-auto px-4 no-scrollbar sm:mx-0 sm:flex-wrap sm:px-0"
      >
        <Block className="h-8 w-40 shrink-0 rounded-full" />
        <Block className="h-8 w-56 shrink-0 rounded-full" />
      </div>
      <JobsGroupsSkeleton />
    </div>
  );
}

/** The board strip while the read is pending: fixed columns at loaded width. */
export function JobsBoardSectionSkeleton() {
  return (
    <div
      aria-hidden="true"
      data-section="jobs-board"
      className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
    >
      <div className="flex min-w-max gap-4">
        {[0, 1, 2, 3].map(column => (
          <BoardColumnSkeleton key={`column-${column}`} />
        ))}
      </div>
    </div>
  );
}

/** The board view of Jobs (?view=board), with its data held back. */
export function JobsBoardSkeleton() {
  return (
    <div
      aria-hidden="true"
      data-page-skeleton="jobs-board"
      className="mx-auto w-full max-w-6xl"
    >
      <HeaderSkeleton board />
      <JobsBoardSectionSkeleton />
    </div>
  );
}

/**
 * A page that is not Jobs, before its own skeleton exists: the header block
 * only, so the shell and the picture stay steady.
 */
export function PageHeaderSkeleton() {
  return (
    <div
      aria-hidden="true"
      data-page-skeleton="page-header"
      className="mx-auto w-full max-w-6xl"
    >
      <Block className="h-8 w-48" />
      <Block className="mt-2 h-4 w-64" />
    </div>
  );
}
