/**
 * A layout-matched placeholder for content that is still being read.
 *
 * One polite status announces the wait once; every visible block is
 * decorative and hidden from a screen reader. Blocks are neutral and only
 * animate when the person has not asked for less motion.
 */

import type { ReactNode } from "react";

type Variant =
  | "page"
  | "cards"
  | "table"
  | "list"
  | "detail"
  | "form"
  | "board"
  | "media";

export interface LoadingSkeletonProps {
  variant?: Variant;
  label?: string;
  rows?: number;
  className?: string;
}

function Block({ className = "" }: { className?: string }) {
  return (
    <div
      className={`min-w-0 max-w-full rounded-[var(--radius-md)] bg-muted motion-safe:animate-pulse ${className}`}
    />
  );
}

function Row({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 max-w-full items-center gap-3">{children}</div>
  );
}

function PageSkeleton({ rows }: { rows: number }) {
  return (
    <div className="min-w-0 max-w-full space-y-5">
      <div className="min-w-0 max-w-full space-y-2">
        <Block className="h-7 w-48" />
        <Block className="h-3 w-64" />
      </div>
      <div className="grid min-w-0 max-w-full grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Block key={i} className="h-24" />
        ))}
      </div>
      <div className="min-w-0 max-w-full space-y-2">
        <Block className="h-9 w-full" />
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="grid min-w-0 max-w-full grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3"
          >
            <Block className="h-4" />
            <Block className="h-4" />
            <Block className="h-4" />
          </div>
        ))}
      </div>
    </div>
  );
}

function CardsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="grid min-w-0 max-w-full grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="min-w-0 max-w-full space-y-3 rounded-xl border p-4"
        >
          <Block className="h-3 w-24" />
          <Block className="h-8 w-32" />
          <Block className="h-3 w-full" />
        </div>
      ))}
    </div>
  );
}

function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div className="min-w-0 max-w-full space-y-2">
      <div className="grid min-w-0 max-w-full grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.75fr)] gap-3 rounded-[var(--radius-md)] bg-muted/50 p-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Block key={i} className="h-3" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="grid min-w-0 max-w-full grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.75fr)] gap-3 px-3 py-1"
        >
          <Block className="h-4" />
          <Block className="h-4" />
          <Block className="h-4" />
          <Block className="h-4" />
        </div>
      ))}
    </div>
  );
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="min-w-0 max-w-full space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Row key={i}>
          <Block className="size-9 shrink-0 rounded-full" />
          <div className="min-w-0 max-w-full flex-1 space-y-1.5">
            <Block className="h-3 w-2/5" />
            <Block className="h-3 w-3/4" />
          </div>
        </Row>
      ))}
    </div>
  );
}

function DetailSkeleton({ rows }: { rows: number }) {
  return (
    <div className="grid min-w-0 max-w-full grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 max-w-full space-y-4">
        <Block className="h-7 w-56" />
        <div className="space-y-2">
          <Block className="h-3 w-full" />
          <Block className="h-3 w-11/12" />
          <Block className="h-3 w-4/5" />
        </div>
        <div className="space-y-2 pt-2">
          {Array.from({ length: rows }, (_, i) => (
            <Block key={i} className="h-4 w-full" />
          ))}
        </div>
      </div>
      <div className="min-w-0 max-w-full space-y-3 rounded-xl border p-4">
        <Block className="h-4 w-28" />
        <Block className="h-3 w-full" />
        <Block className="h-3 w-5/6" />
        <Block className="h-20 w-full" />
      </div>
    </div>
  );
}

function FormSkeleton({ rows }: { rows: number }) {
  return (
    <div className="min-w-0 max-w-full space-y-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="min-w-0 max-w-full space-y-1.5">
          <Block className="h-3 w-28" />
          <Block className="h-10 w-full" />
        </div>
      ))}
    </div>
  );
}

function BoardSkeleton({ rows }: { rows: number }) {
  return (
    <div className="grid min-w-0 max-w-full grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="min-w-0 max-w-full space-y-3">
          <Block className="h-4 w-32" />
          <div className="space-y-2">
            <Block className="h-24 w-full" />
            <Block className="h-24 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function MediaSkeleton({ rows }: { rows: number }) {
  return (
    <div className="grid min-w-0 max-w-full grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="min-w-0 max-w-full space-y-2">
          <Block className="aspect-video w-full" />
          <Block className="h-3 w-3/4" />
          <Block className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function LoadingSkeleton({
  variant = "page",
  label = "Loading content",
  rows = 4,
  className = "",
}: LoadingSkeletonProps) {
  const count = Math.max(1, Math.min(12, Math.floor(rows)));
  return (
    <div
      role="status"
      aria-busy="true"
      className={`min-w-0 max-w-full ${className}`}
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden className="min-w-0 max-w-full">
        {variant === "page" ? <PageSkeleton rows={count} /> : null}
        {variant === "cards" ? <CardsSkeleton rows={count} /> : null}
        {variant === "table" ? <TableSkeleton rows={count} /> : null}
        {variant === "list" ? <ListSkeleton rows={count} /> : null}
        {variant === "detail" ? <DetailSkeleton rows={count} /> : null}
        {variant === "form" ? <FormSkeleton rows={count} /> : null}
        {variant === "board" ? <BoardSkeleton rows={count} /> : null}
        {variant === "media" ? <MediaSkeleton rows={count} /> : null}
      </div>
    </div>
  );
}
