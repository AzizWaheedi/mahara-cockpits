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
        size === "sm" ? "h-5 px-2 text-xs" : "h-6 px-2 text-xs"
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
  // A divider under the title only when the body is a list or table that
  // runs edge to edge; otherwise the card is one padded surface.
  return (
    <section
      id={id}
      className={`panel min-w-0 overflow-hidden ${flush ? "" : "p-4 sm:p-6"} ${className}`}
    >
      <header
        className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 ${
          flush ? "border-b hairline px-4 py-3" : ""
        }`}
      >
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {side}
      </header>
      <div className={flush ? "" : "mt-4"}>{children}</div>
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
  variant = "panel",
  className = "",
}: {
  label: string;
  /** Formatted already; "n/a", "--" or null shows n/a. */
  value: ReactNode;
  sub?: ReactNode;
  status?: ReactNode;
  hint?: string;
  onClick?: () => void;
  /** "plain" for a tile inside a card: a quiet fill, no second border. */
  variant?: "panel" | "plain";
  className?: string;
}) {
  const [why, setWhy] = useState(false);
  const shown =
    value === null ||
    value === undefined ||
    value === "--" ||
    value === "n/a" ? (
      <Na why={hint} />
    ) : (
      value
    );
  const body = (
    <>
      <div className="muted flex min-w-0 items-start gap-1 text-xs leading-5">
        <span className="line-clamp-2 min-w-0">{label}</span>
        {hint && !onClick ? (
          // A tap opens the explanation under the label: a hover title
          // never shows on a phone or an iPad.
          <button
            type="button"
            aria-expanded={why}
            aria-label={why ? "Hide what this counts" : "What this counts"}
            onClick={() => setWhy(w => !w)}
            className="no-touch relative mt-[3px] inline-flex shrink-0 cursor-help opacity-70 after:absolute after:-inset-2 after:content-[''] hover:opacity-100"
          >
            <Info className="size-3.5" aria-hidden />
          </button>
        ) : hint ? (
          <span
            title={hint}
            className="mt-[3px] inline-flex shrink-0 opacity-70"
          >
            <Info className="size-3.5" aria-label={hint} />
          </span>
        ) : null}
      </div>
      {why && hint ? (
        <p className="muted mt-1 text-xs leading-relaxed">{hint}</p>
      ) : null}
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="text-2xl font-semibold leading-8 tracking-tight [overflow-wrap:anywhere] tabular-nums">
          {shown}
        </div>
        {status ? <div className="shrink-0">{status}</div> : null}
      </div>
      {sub ? <div className="muted mt-1 text-xs leading-5">{sub}</div> : null}
    </>
  );
  const cls = `${
    variant === "plain"
      ? "rounded-[var(--radius-lg)] bg-[color:var(--secondary)]"
      : "panel"
  } min-w-0 p-4 text-left ${className}`;
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

/**
 * "Where these numbers come from", folded under a card, as in the CEO
 * cockpit. A note that is not about numbers names itself with `label`.
 */
export function SourceNote({
  children,
  label = "Where these numbers come from",
}: {
  children: ReactNode;
  label?: string;
}) {
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
          ? `Hide ${label.charAt(0).toLowerCase()}${label.slice(1)}`
          : label}
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
/** A choice in a page header or toolbar ("Whose calls"); form selects use `field`. */
export const select =
  "h-8 min-w-0 max-w-[16rem] rounded-[var(--radius-md)] border hairline bg-[color:var(--card)] px-2.5 text-sm";

/**
 * The page frame: one width and one rhythm for every page. The shell does
 * not pad, so the frame does (16px on a phone, 24px from a tablet up).
 */
export const page = "mx-auto w-full max-w-6xl space-y-6 px-4 py-6 md:px-6";
/** The same frame for the wide working screens (a lead, a call). */
export const pageWide =
  "mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 md:px-6";

/** A filter or view pill: teal when on, quiet when off. */
const PILL =
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-medium transition-colors";
const PILL_ON =
  "bg-[color:color-mix(in_oklch,var(--primary)_15%,transparent)] text-[color:var(--foreground)] ring-1 ring-[color:color-mix(in_oklch,var(--primary)_40%,transparent)] ring-inset";
const PILL_OFF =
  "muted hover:bg-[color:var(--muted)] hover:text-[color:var(--foreground)]";

/**
 * One choice of a few (a view, a window, a role): pills in a quiet track,
 * the chosen one teal. A row too long for a phone scrolls sideways.
 */
export function Segmented({
  label,
  value,
  options,
  onChange,
  className = "",
}: {
  label: string;
  value: string;
  options: [string, ReactNode][];
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`no-scrollbar inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-[color:var(--muted)] p-0.5 ${className}`}
    >
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`${PILL} h-7 ${value === v ? PILL_ON : PILL_OFF}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** A filter chip, with how many it holds when that is known. */
export function FilterChip({
  on,
  onClick,
  count,
  children,
}: {
  on: boolean;
  onClick: () => void;
  count?: number | null;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`${PILL} h-8 border ${on ? `border-transparent ${PILL_ON}` : `hairline ${PILL_OFF}`}`}
    >
      {children}
      {count === null || count === undefined ? null : (
        <span className="tabular-nums opacity-70">{count}</span>
      )}
    </button>
  );
}

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
