import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Inbox,
  Info,
  type LucideIcon,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";

/**
 * The CEO kit's pieces with the same names and the same rules, for an app
 * with no shadcn layer: a section is a card with a header, a number is a
 * tile, a state is a chip whose colour sits on the icon while the words stay
 * in text colour, and nothing that is missing is ever drawn as zero.
 */

export type Tone = "good" | "warning" | "serious" | "critical" | "neutral";

const ICON: Record<Tone, LucideIcon> = {
  good: CircleCheck,
  warning: TriangleAlert,
  serious: CircleAlert,
  critical: OctagonAlert,
  neutral: CircleDashed,
};

const COLOR: Record<Tone, string> = {
  good: "var(--success)",
  warning: "var(--warning)",
  serious: "oklch(0.68 0.16 45)",
  critical: "var(--destructive)",
  neutral: "var(--muted-foreground)",
};

export function StatusChip({
  tone,
  label,
  size = "sm",
  title,
}: {
  tone: Tone;
  label: string;
  size?: "sm" | "md";
  title?: string;
}) {
  const Icon = ICON[tone];
  return (
    <span
      title={title}
      className={`inline-flex max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-full border hairline font-medium ${
        size === "sm" ? "h-5 px-1.5 text-[11px]" : "h-6 px-2 text-xs"
      }`}
      style={{
        background: "color-mix(in oklch, var(--background) 60%, transparent)",
      }}
    >
      <Icon
        className={size === "sm" ? "size-3" : "size-3.5"}
        style={{ color: COLOR[tone] }}
        aria-hidden
      />
      <span className="truncate">{label}</span>
    </span>
  );
}

export function SectionCard({
  title,
  side,
  children,
  flush = false,
  id,
  className = "",
}: {
  title: ReactNode;
  side?: ReactNode;
  children: ReactNode;
  /** No padding around the body, for tables and lists that run edge to edge. */
  flush?: boolean;
  id?: string;
  className?: string;
}) {
  return (
    <section id={id} className={`panel min-w-0 overflow-hidden ${className}`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b hairline px-4 py-2.5">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {side}
      </header>
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

/** "n/a" with the reason on hover, never a zero standing in for "unknown". */
export function Na({ why }: { why?: string }) {
  return (
    <span className="muted" title={why ?? "Not known yet"}>
      n/a
    </span>
  );
}

export function StatTile({
  label,
  value,
  sub,
  status,
  hint,
  onClick,
  className = "",
}: {
  label: string;
  /** Formatted already; "--" or null shows n/a. */
  value: ReactNode;
  sub?: ReactNode;
  status?: ReactNode;
  hint?: string;
  onClick?: () => void;
  className?: string;
}) {
  const shown =
    value === null || value === undefined || value === "--" ? (
      <Na why={hint} />
    ) : (
      value
    );
  const body = (
    <>
      <div className="muted flex min-w-0 items-start gap-1 text-[13px] leading-5">
        <span className="line-clamp-2 min-w-0">{label}</span>
        {hint ? (
          <span
            title={hint}
            className="mt-[3px] inline-flex shrink-0 cursor-help opacity-70"
          >
            <Info className="size-3.5" aria-label={hint} />
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="text-2xl font-semibold leading-8 tracking-tight [overflow-wrap:anywhere] tabular-nums">
          {shown}
        </div>
        {status ? <div className="shrink-0">{status}</div> : null}
      </div>
      {sub ? <div className="muted mt-1 text-xs leading-5">{sub}</div> : null}
    </>
  );
  const cls = `panel min-w-0 p-4 text-left ${className}`;
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={`${cls} hover:bg-[color:var(--secondary)]`}
    >
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function EmptyState({
  title,
  text,
  icon: Icon = Inbox,
  action,
  compact = false,
}: {
  title: string;
  text?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 text-center ${
        compact ? "px-3 py-6" : "px-4 py-10"
      }`}
    >
      <span className="raised muted flex size-9 items-center justify-center rounded-full">
        <Icon className="size-4" aria-hidden />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {text ? (
        <p className="muted max-w-sm text-xs leading-relaxed">{text}</p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/** A read that failed, said plainly, with the way to try again. */
export function Failed({
  what,
  error,
  retry,
}: {
  what: string;
  error: string;
  retry?: () => void;
}) {
  return (
    <div className="callout-bad rounded-[var(--radius-md)] border px-3 py-2 text-sm">
      {what} could not be read: {error}.{" "}
      {retry ? (
        <button
          type="button"
          onClick={retry}
          className="underline underline-offset-2"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

/** "Where these numbers come from", folded under a card, as in the CEO cockpit. */
export function SourceNote({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="mt-3 border-t hairline pt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(o => !o)}
        className="muted text-xs underline-offset-2 hover:underline"
      >
        {open
          ? "Hide where these numbers come from"
          : "Where these numbers come from"}
      </button>
      {open ? (
        <div id={id} className="muted mt-2 space-y-1.5 text-xs leading-relaxed">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** A small initials disc for a person. */
export function Avatar({
  name,
  size = 28,
}: {
  name: string | null | undefined;
  size?: number;
}) {
  const parts = String(name ?? "?")
    .trim()
    .split(/\s+/);
  const text = ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
      style={{
        width: size,
        height: size,
        background: "color-mix(in oklch, var(--primary) 18%, transparent)",
        color: "var(--primary)",
      }}
    >
      {text}
    </span>
  );
}

export const button =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border hairline px-3 text-sm font-medium hover:bg-[color:var(--secondary)] disabled:opacity-50";
export const buttonPrimary =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-[color:var(--primary)] px-3 text-sm font-semibold text-[color:var(--primary-foreground)] hover:opacity-90 disabled:opacity-50";
export const field =
  "h-9 w-full rounded-[var(--radius-md)] border hairline bg-[color:var(--background)] px-3 text-sm placeholder:text-[color:var(--muted-foreground)]";

/**
 * Short facts in a row, "a · b · c", each set in its own text direction, so
 * a line that mixes an Arabic answer with a dollar band keeps its order.
 */
export function Parts({ items }: { items: (string | null | undefined)[] }) {
  const list = items.filter((x): x is string => Boolean(x?.trim()));
  return (
    <>
      {list.map((x, i) => (
        <span key={`${i}-${x}`}>
          {i ? " · " : null}
          <bdi>{x}</bdi>
        </span>
      ))}
    </>
  );
}
