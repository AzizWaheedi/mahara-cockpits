import { ArrowUpRight, ChevronDown, Loader2 } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import type { JobState } from "../lib/types";

/**
 * Waiting on somebody is a warning, not a failure: orange. Red is kept for
 * the one thing that is actually wrong, a job past its date.
 */
const STATE_WORDS: Record<string, { label: string; tone: string }> = {
  ready: { label: "Ready to start", tone: "var(--success)" },
  blocked: { label: "Blocked", tone: "var(--warning)" },
  new: { label: "Not read yet", tone: "var(--warning)" },
  stale: { label: "Reading again", tone: "var(--warning)" },
  delivered: { label: "Delivered", tone: "var(--primary)" },
  gone: { label: "Card deleted", tone: "var(--muted-foreground)" },
};

/** The status chip: the colour sits on the dot, the words stay readable. */
export function StateBadge({ state }: { state: JobState | string | null }) {
  const it = STATE_WORDS[String(state ?? "")] ?? {
    label: String(state ?? "Unknown"),
    tone: "var(--muted-foreground)",
  };
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium">
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ background: it.tone }}
      />
      {it.label}
    </span>
  );
}

/** The small mono label above a value or a block (three words at most). */
export const KICKER =
  "font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground";

/** Every text field on the desk, so a field looks the same on every page. */
export const FIELD =
  "w-full rounded-lg border bg-background px-3 text-sm placeholder:text-muted-foreground disabled:opacity-50";

/** A filter or a toggle: teal when on, quiet when off. */
export function chip(on: boolean): string {
  return `inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-medium transition-colors ${
    on
      ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40"
      : "bg-muted text-muted-foreground hover:text-foreground"
  }`;
}

/**
 * The page's frame: the gutter, the width and the one heading. This app has
 * no padded layout around its pages, so each page brings its own.
 */
export function Page({
  wide = false,
  children,
}: {
  /** Galleries and the board; reading pages stay narrow. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 ${
        wide ? "max-w-6xl" : "max-w-3xl"
      }`}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  sub,
  actions,
  dir,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  dir?: "auto";
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 dir={dir} className="text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        {sub ? (
          <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

/** A card: its title, anything that belongs beside it, then the body. */
export function Section({
  title,
  side,
  children,
}: {
  title: string;
  side?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-card p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {side}
      </header>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A long document an editor reads once and then wants out of the way. */
export function Fold({
  title,
  hint,
  children,
  open: initial = false,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  open?: boolean;
}) {
  const [open, setOpen] = useState(initial);
  const id = useId();
  return (
    <div className="border-t first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between gap-3 py-3 text-left"
      >
        <span className="text-sm font-medium">{title}</span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {hint}
          <ChevronDown
            aria-hidden
            className={`size-4 transition-transform motion-reduce:transition-none ${
              open ? "rotate-180" : ""
            }`}
          />
        </span>
      </button>
      <div id={id} hidden={!open} className="pb-3">
        {children}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>
  );
}

export function Problem({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="callout-bad rounded-xl border px-4 py-3 text-sm">
      {children}
    </p>
  );
}

export function Spinner({ what = "Loading" }: { what?: string }) {
  return (
    <p
      className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"
      role="status"
    >
      <Loader2 aria-hidden className="size-4 animate-spin" />
      {what}…
    </p>
  );
}

/** Long text that may be Arabic, English, or both in one paragraph.
 * `dir="auto"` lets the browser set the direction from the first strong
 * character, which is the only thing that reads correctly when a Gulf script
 * carries English product names inside Arabic sentences. */
export function Prose({ text }: { text: string }) {
  return (
    <div
      dir="auto"
      className="rtl-safe dim max-h-96 overflow-y-auto whitespace-pre-wrap text-sm"
    >
      {text}
    </div>
  );
}

export function Row({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3 py-1 text-sm">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

/** A link that leaves the desk: one trailing arrow, never two. */
export function Out({
  href,
  children,
}: {
  href: string | null | undefined;
  children: ReactNode;
}) {
  if (!href) return <span className="text-muted-foreground">Not set</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
    >
      {children}
      <ArrowUpRight aria-hidden className="size-3.5 shrink-0" />
    </a>
  );
}
