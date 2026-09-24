import { ChevronRight } from "lucide-react";
import { type ReactNode, useId } from "react";

/**
 * The small controls the Team page is built from. A switch takes effect the
 * moment it is flipped; a field saves with its card's button. Same recipe
 * as the CEO kit's switch (role="switch", teal when on).
 */

export function TeamSwitch({
  on,
  label,
  disabled,
  onChange,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
      style={{
        background: on
          ? "var(--primary)"
          : "color-mix(in oklch, var(--muted-foreground) 40%, transparent)",
      }}
    >
      <span
        aria-hidden
        className={`absolute top-0.5 size-5 rounded-full shadow-sm transition-[left] ${
          on ? "left-[22px]" : "left-0.5"
        }`}
        style={{ background: "var(--background)" }}
      />
    </button>
  );
}

/** A label above its control, with a line of help or an error under it. */
export function TeamField({
  label,
  htmlFor,
  help,
  error,
  children,
  className = "",
}: {
  label: ReactNode;
  htmlFor?: string;
  help?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      {htmlFor ? (
        <label
          htmlFor={htmlFor}
          className="muted mb-1 block text-xs font-medium"
        >
          {label}
        </label>
      ) : (
        <p className="muted mb-1 text-xs font-medium">{label}</p>
      )}
      {children}
      {error ? (
        <p className="mt-1 text-xs" style={{ color: "var(--destructive)" }}>
          {error}
        </p>
      ) : help ? (
        <div className="muted mt-1 text-xs">{help}</div>
      ) : null}
    </div>
  );
}

/** A folded part of a card: its title, a one-line summary, and the editor when open. */
export function TeamDisclosure({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="border-t hairline">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-[color:var(--secondary)]"
      >
        <ChevronRight
          aria-hidden
          className={`muted mt-0.5 size-4 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{title}</span>
          <span className="muted line-clamp-2 block text-xs">{summary}</span>
        </span>
      </button>
      {open ? (
        <div id={id} className="px-4 pb-4">
          {children}
        </div>
      ) : null}
    </div>
  );
}
