import { type ReactNode, useId, useState } from "react";
import type { JobState } from "../lib/types";

const STATE_WORDS: Record<string, { label: string; tone: string }> = {
  ready: { label: "Ready to start", tone: "var(--color-ready)" },
  blocked: { label: "Blocked", tone: "var(--color-blocked)" },
  new: { label: "Not read yet", tone: "var(--color-waiting)" },
  stale: { label: "Reading again", tone: "var(--color-waiting)" },
  delivered: { label: "Delivered", tone: "var(--color-accent)" },
};

export function StateBadge({ state }: { state: JobState | string | null }) {
  const it = STATE_WORDS[String(state ?? "")] ?? {
    label: String(state ?? "unknown"),
    tone: "var(--muted)",
  };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ color: it.tone, background: `color-mix(in oklch, ${it.tone} 14%, transparent)` }}
    >
      <span className="size-1.5 rounded-full" style={{ background: it.tone }} />
      {it.label}
    </span>
  );
}

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
    <section className="panel overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b hairline px-4 py-2.5">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {side}
      </header>
      <div className="p-4">{children}</div>
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
    <div className="border-t hairline first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 py-2.5 text-left"
      >
        <span className="text-sm font-medium">{title}</span>
        <span className="muted shrink-0 text-xs">
          {hint ? `${hint} · ` : ""}
          {open ? "hide" : "show"}
        </span>
      </button>
      <div id={id} hidden={!open} className="pb-3">
        {children}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted py-6 text-center text-sm">{children}</p>;
}

export function Problem({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-[color:var(--color-blocked)]/40 bg-[color:var(--color-blocked)]/10 px-3 py-2 text-sm">
      {children}
    </p>
  );
}

export function Spinner({ what = "Loading" }: { what?: string }) {
  return (
    <p className="muted py-8 text-center text-sm" role="status">
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
    <div dir="auto" className="rtl-safe dim max-h-96 overflow-y-auto whitespace-pre-wrap text-sm">
      {text}
    </div>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-1 text-sm">
      <span className="muted w-28 shrink-0">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

export function Out({ href, children }: { href: string | null | undefined; children: ReactNode }) {
  if (!href) return <span className="muted">--</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-[color:var(--color-accent)] underline underline-offset-2"
    >
      {children}
    </a>
  );
}
