import { ArrowUpRight, CircleAlert, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The small parts the results and speed screens share. They use the cockpits' own classes, the same ones
 * as the CEO kit's FilterChips, StatusChip and Kicker and the client success kit's Pill, Chip and Kicker
 * (docs/DESIGN.md), so the same file sits in the media buyer and client success cockpits without importing
 * either kit. results-screens.test.ts keeps the two copies equal.
 */

/** The mono kicker above a title: three words at most. */
export const KICKER =
  "font-mono text-[11px] font-normal uppercase leading-4 tracking-[0.08em] text-muted-foreground";

/** The card: title, an optional kicker of three words, the body 16px below. */
export function ResultCard({
  title,
  kicker,
  aside,
  children,
  className,
  id,
}: {
  title: ReactNode;
  kicker?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className={cn("min-w-0 rounded-2xl border bg-card p-4 sm:p-6", className)}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          {kicker ? <p className={KICKER}>{kicker}</p> : null}
          <h2
            id={id ? `${id}-title` : undefined}
            className={cn("text-[15px] font-semibold", kicker ? "mt-1" : "")}
          >
            {title}
          </h2>
        </div>
        {aside}
      </header>
      <div className="mt-4 min-w-0">{children}</div>
    </section>
  );
}

export type DotTone = "warn" | "neutral" | "good" | "accent";
const DOT: Record<DotTone, string> = {
  warn: "bg-warning",
  neutral: "bg-muted-foreground/60",
  good: "bg-success",
  accent: "bg-primary",
};

/** A status chip: the colour on the dot only, 12px, rounded-full. */
export function StateChip({
  tone = "neutral",
  children,
  title,
  className,
}: {
  tone?: DotTone;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", DOT[tone])}
      />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/** A 32px pill row: the active pill is teal, one that cannot fit scrolls sideways. */
export function Pills<K extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "no-scrollbar -my-1 flex min-w-0 max-w-full items-center gap-1 overflow-x-auto py-1",
        className,
      )}
    >
      {options.map(o => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.key)}
            className={cn(
              "no-touch relative inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-medium transition-colors after:absolute after:-inset-1 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              active
                ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** An empty or waiting state in one place: what is true, and what to do next. */
export function Notice({
  title,
  text,
  action,
}: {
  title: string;
  text?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg px-3 py-6 text-center">
      <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Inbox className="size-4" aria-hidden />
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {text ? (
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          {text}
        </p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/** A read that failed, as one plain sentence with a way to try again. */
export function Problem({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/40 p-4"
    >
      <p className="flex min-w-0 items-start gap-2 text-sm">
        <CircleAlert
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-warning"
        />
        <span>{message}</span>
      </p>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** Rows that stand where the data will be, so the card does not jump. */
export function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={`row-${i + 1}`} className="h-9 w-full" />
      ))}
    </div>
  );
}

/** The line under a card: where the numbers come from and what they leave out. */
export function SourceNote({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

/** A warning that changes how the numbers read: stays visible. */
export function WarnLine({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
      <span
        aria-hidden
        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning"
      />
      <span>{children}</span>
    </p>
  );
}

/** A link that leaves the app: teal text, one trailing arrow. */
export function OutLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline",
        className,
      )}
    >
      {children}
      <ArrowUpRight aria-hidden className="size-3.5 shrink-0" />
    </a>
  );
}
