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

type LoadingSkeletonProps = {
  variant?: LoadingSkeletonVariant;
  label?: string;
  rows?: number;
  className?: string;
};

const DEFAULT_LABEL: Record<LoadingSkeletonVariant, string> = {
  page: "Loading page",
  cards: "Loading cards",
  table: "Loading table",
  list: "Loading list",
  detail: "Loading details",
  form: "Loading form",
  board: "Loading board",
  media: "Loading media",
};

const BLOCK = "rounded-md bg-muted motion-safe:animate-pulse";

function Block({ className }: { className?: string }) {
  return <div className={cn(BLOCK, className)} />;
}

function boundedRows(rows: number): number {
  if (!Number.isFinite(rows)) return 4;
  return Math.min(12, Math.max(1, Math.trunc(rows)));
}

function Page({ count }: { count: number }) {
  return (
    <div className="space-y-5">
      <Block className="h-8 w-52 max-w-full" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map(i => (
          <Block key={`metric-${i}`} className="h-24 w-full" />
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border">
        <Block className="h-10 w-full rounded-none" />
        <div className="divide-y">
          {Array.from({ length: count }, (_, i) => (
            <div key={`row-${i}`} className="flex items-center gap-3 px-3 py-3">
              <Block className="h-4 w-1/3 max-w-full" />
              <Block className="h-4 w-1/4 max-w-full" />
              <Block className="h-4 w-16 max-w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Cards({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={`card-${i}`} className="space-y-3 rounded-xl border p-4">
          <Block className="h-4 w-2/3 max-w-full" />
          <Block className="h-8 w-24 max-w-full" />
          <Block className="h-3 w-full" />
          <Block className="h-3 w-4/5 max-w-full" />
        </div>
      ))}
    </div>
  );
}

function TableBody({ count }: { count: number }) {
  const columns =
    "grid grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] gap-3 px-3";
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[32rem] overflow-hidden rounded-xl border">
        <div className={cn(columns, "border-b bg-muted/40 py-3")}>
          {[0, 1, 2, 3].map(i => (
            <Block key={`head-${i}`} className="h-3 w-full max-w-24" />
          ))}
        </div>
        <div className="divide-y">
          {Array.from({ length: count }, (_, i) => (
            <div key={`row-${i}`} className={cn(columns, "py-3")}>
              {[0, 1, 2, 3].map(cell => (
                <Block
                  key={`cell-${i}-${cell}`}
                  className="h-4 w-full max-w-32"
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function List({ count }: { count: number }) {
  return (
    <ul className="divide-y rounded-xl border">
      {Array.from({ length: count }, (_, i) => (
        <li
          key={`item-${i}`}
          className="flex min-w-0 items-center gap-3 px-3 py-3"
        >
          <Block className="size-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Block className="h-4 w-2/3 max-w-full" />
            <Block className="h-3 w-1/3 max-w-full" />
          </div>
          <Block className="h-3 w-14 shrink-0" />
        </li>
      ))}
    </ul>
  );
}

function Detail({ count }: { count: number }) {
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-4">
        <Block className="h-7 w-2/3 max-w-full" />
        {Array.from({ length: count }, (_, i) => (
          <Block
            key={`paragraph-${i}`}
            className={cn(
              "h-4 max-w-full",
              i === count - 1 ? "w-4/5" : "w-full",
            )}
          />
        ))}
      </div>
      <div className="min-w-0 space-y-3 rounded-xl border p-4">
        <Block className="h-4 w-1/2 max-w-full" />
        <Block className="h-24 w-full" />
        <Block className="h-3 w-2/3 max-w-full" />
      </div>
    </div>
  );
}

function Form({ count }: { count: number }) {
  return (
    <div className="grid min-w-0 gap-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={`field-${i}`} className="space-y-2">
          <Block className="h-3 w-24 max-w-full" />
          <Block className="h-10 w-full" />
        </div>
      ))}
    </div>
  );
}

function Board({ count }: { count: number }) {
  return (
    <div className="flex min-w-0 gap-3 overflow-x-auto pb-1">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={`column-${i}`}
          className="min-w-[13rem] flex-1 space-y-3 rounded-xl border p-3"
        >
          <Block className="h-4 w-1/2 max-w-full" />
          {[0, 1, 2].map(j => (
            <Block key={`card-${i}-${j}`} className="h-20 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}

function Media() {
  return (
    <div className="min-w-0 space-y-3">
      <Block className="aspect-video w-full max-w-full rounded-xl" />
      <Block className="h-4 w-3/4 max-w-full" />
      <Block className="h-3 w-1/2 max-w-full" />
    </div>
  );
}

function Body({
  variant,
  count,
}: {
  variant: LoadingSkeletonVariant;
  count: number;
}) {
  switch (variant) {
    case "cards":
      return <Cards count={count} />;
    case "table":
      return <TableBody count={count} />;
    case "list":
      return <List count={count} />;
    case "detail":
      return <Detail count={count} />;
    case "form":
      return <Form count={count} />;
    case "board":
      return <Board count={count} />;
    case "media":
      return <Media />;
    default:
      return <Page count={count} />;
  }
}

export function LoadingSkeleton({
  variant = "page",
  label,
  rows = 4,
  className,
}: LoadingSkeletonProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      className={cn("w-full min-w-0 max-w-full", className)}
    >
      <span className="sr-only">{label ?? DEFAULT_LABEL[variant]}</span>
      <div aria-hidden="true">
        <Body variant={variant} count={boundedRows(rows)} />
      </div>
    </div>
  );
}
