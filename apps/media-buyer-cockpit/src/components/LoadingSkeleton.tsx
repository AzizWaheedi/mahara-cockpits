import { cn } from "@/lib/utils";

export type LoadingSkeletonVariant =
  | "page"
  | "cards"
  | "table"
  | "list"
  | "detail"
  | "form"
  | "board"
  | "media";

export type LoadingSkeletonProps = {
  variant?: LoadingSkeletonVariant;
  label?: string;
  rows?: number;
  className?: string;
};

const DEFAULT_LABEL = "Loading content";

function Block({ className }: { className?: string }) {
  return (
    <div
      className={cn("rounded-md bg-muted motion-safe:animate-pulse", className)}
    />
  );
}

function keys(rows: number) {
  return Array.from({ length: Math.max(1, rows) }, (_, i) => i);
}

function PageSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Block className="h-8 w-56 max-w-full" />
        <Block className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {keys(4).map(i => (
          <div key={i} className="rounded-2xl border p-4">
            <Block className="h-3 w-20 max-w-full" />
            <Block className="mt-3 h-7 w-28 max-w-full" />
            <Block className="mt-2 h-3 w-16 max-w-full" />
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border">
        <div className="flex gap-3 border-b bg-muted/30 p-3">
          <Block className="h-3 w-28 max-w-full" />
          <Block className="h-3 w-16 max-w-full" />
          <Block className="h-3 w-16 max-w-full" />
          <Block className="ml-auto h-3 w-12 max-w-full" />
        </div>
        {keys(rows).map(i => (
          <div
            key={i}
            className="flex items-center gap-3 border-b p-3 last:border-b-0"
          >
            <Block className="h-4 w-40 max-w-full" />
            <Block className="h-4 w-16 max-w-full" />
            <Block className="h-4 w-16 max-w-full" />
            <Block className="ml-auto h-4 w-10 max-w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

function CardsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {keys(rows).map(i => (
        <div key={i} className="min-w-0 rounded-2xl border p-4">
          <Block className="h-3 w-20 max-w-full" />
          <Block className="mt-3 h-7 w-24 max-w-full" />
          <Block className="mt-2 h-3 w-16 max-w-full" />
        </div>
      ))}
    </div>
  );
}

function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border">
      <div className="flex gap-3 border-b bg-muted/30 p-3">
        <Block className="h-3 w-32 max-w-full" />
        <Block className="h-3 w-20 max-w-full" />
        <Block className="h-3 w-20 max-w-full" />
        <Block className="ml-auto h-3 w-14 max-w-full" />
      </div>
      {keys(rows).map(i => (
        <div
          key={i}
          className="flex items-center gap-3 border-b p-3 last:border-b-0"
        >
          <Block className="h-4 w-40 max-w-full" />
          <Block className="h-4 w-20 max-w-full" />
          <Block className="h-4 w-20 max-w-full" />
          <Block className="ml-auto h-4 w-12 max-w-full" />
        </div>
      ))}
    </div>
  );
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="min-w-0 divide-y rounded-xl border">
      {keys(rows).map(i => (
        <div key={i} className="flex items-center gap-3 p-3">
          <Block className="size-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Block className="h-4 w-40 max-w-full" />
            <Block className="h-3 w-24 max-w-full" />
          </div>
          <Block className="h-3 w-12 shrink-0" />
        </div>
      ))}
    </div>
  );
}

function DetailSkeleton({ rows }: { rows: number }) {
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-4">
        <Block className="h-7 w-64 max-w-full" />
        {keys(rows).map(i => (
          <div key={i} className="space-y-2">
            <Block className="h-4 w-full max-w-full" />
            <Block className="h-4 w-11/12 max-w-full" />
            <Block className="h-4 w-2/3 max-w-full" />
          </div>
        ))}
      </div>
      <aside className="min-w-0 space-y-3 rounded-2xl border p-4">
        <Block className="h-4 w-32 max-w-full" />
        <Block className="h-20 w-full max-w-full" />
        <Block className="h-4 w-24 max-w-full" />
        <Block className="h-10 w-full max-w-full" />
      </aside>
    </div>
  );
}

function FormSkeleton({ rows }: { rows: number }) {
  return (
    <div className="min-w-0 space-y-4">
      {keys(rows).map(i => (
        <div key={i} className="space-y-2">
          <Block className="h-3 w-28 max-w-full" />
          <Block className="h-10 w-full max-w-full" />
        </div>
      ))}
    </div>
  );
}

function BoardSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex min-w-0 gap-4 overflow-x-auto pb-1">
      {keys(Math.min(Math.max(1, rows), 5)).map(i => (
        <div
          key={i}
          className="min-w-[14rem] flex-1 space-y-3 rounded-2xl border p-3"
        >
          <Block className="h-4 w-28 max-w-full" />
          <Block className="h-20 w-full max-w-full rounded-xl" />
          <Block className="h-20 w-full max-w-full rounded-xl" />
          <Block className="h-4 w-16 max-w-full" />
        </div>
      ))}
    </div>
  );
}

function MediaSkeleton() {
  return (
    <div className="w-full min-w-0 max-w-sm space-y-3">
      <Block className="aspect-video w-full max-w-full rounded-xl" />
      <Block className="h-4 w-3/4 max-w-full" />
      <Block className="h-3 w-1/2 max-w-full" />
    </div>
  );
}

/**
 * A layout-matched placeholder for one region that is still being read.
 * The wrapper is the single status; every shape inside is decorative.
 */
export function LoadingSkeleton({
  variant = "page",
  label = DEFAULT_LABEL,
  rows = 4,
  className,
}: LoadingSkeletonProps) {
  const count = Math.max(1, rows);
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn("min-w-0 max-w-full", className)}
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="min-w-0 max-w-full">
        {variant === "page" ? <PageSkeleton rows={count} /> : null}
        {variant === "cards" ? <CardsSkeleton rows={count} /> : null}
        {variant === "table" ? <TableSkeleton rows={count} /> : null}
        {variant === "list" ? <ListSkeleton rows={count} /> : null}
        {variant === "detail" ? <DetailSkeleton rows={count} /> : null}
        {variant === "form" ? <FormSkeleton rows={count} /> : null}
        {variant === "board" ? <BoardSkeleton rows={count} /> : null}
        {variant === "media" ? <MediaSkeleton /> : null}
      </div>
    </div>
  );
}
