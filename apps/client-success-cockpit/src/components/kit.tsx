import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The few pieces every client success screen shares, drawn once so the
 * pages stop inventing their own: the page header, a stat tile, a status
 * chip, a filter pill and an outside link. The rules they follow are the
 * portal's design conventions (Mahara brand guidelines v1.0).
 */

/** One page header for every screen: the title, one muted line, actions on the right. */
export function PageHeader({
  title,
  sub,
  actions,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  /** Anything that belongs to the title block, under the muted line. */
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9">
          {title}
        </h1>
        {sub ? (
          <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
        ) : null}
        {children}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

/**
 * One stat tile: a label, the number in Geist, an optional line under it.
 * `plain` is for tiles that sit inside a card (a quiet panel, no border).
 */
export function StatTile({
  label,
  value,
  sub,
  tone,
  plain,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  /** A txt-* class for the value when the number itself is good or bad news. */
  tone?: string;
  plain?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0",
        plain ? "rounded-xl bg-muted/40 p-4" : "rounded-2xl border bg-card p-4",
        className,
      )}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 whitespace-nowrap text-2xl font-semibold tracking-tight tabular-nums",
          tone,
        )}
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
      ) : null}
    </div>
  );
}

export type Tone = "good" | "warn" | "bad" | "neutral" | "accent";

const DOT: Record<Tone, string> = {
  good: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
  neutral: "bg-muted-foreground/60",
  accent: "bg-primary",
};

/** The status dot on its own, for a row that only needs the colour. */
export function Dot({ tone, label }: { tone: Tone; label?: string }) {
  const dot = cn("inline-block size-1.5 shrink-0 rounded-full", DOT[tone]);
  return label ? (
    <span role="img" aria-label={label} title={label} className={dot} />
  ) : (
    <span aria-hidden className={dot} />
  );
}

/**
 * A status chip. The colour sits on the dot only; the words stay readable
 * in both themes. `dot={false}` for a plain label chip.
 */
export function Chip({
  tone = "neutral",
  dot = true,
  children,
  className,
  title,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        className,
      )}
    >
      {dot ? <Dot tone={tone} /> : null}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/** A filter or view switch. The active one carries the teal. */
export function Pill({
  active,
  onClick,
  children,
  disabled,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-xs font-medium transition-colors disabled:opacity-40",
        active
          ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** A row of pills that scrolls sideways on a phone rather than wrapping. */
export function PillRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "no-scrollbar relative -mx-1 flex flex-nowrap items-center gap-1 overflow-x-auto px-1 py-0.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A link that leaves the app: one trailing arrow, teal text. */
export function ExtLink({
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

/** The mono kicker above a group of rows: three words at most. */
export function Kicker({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}
