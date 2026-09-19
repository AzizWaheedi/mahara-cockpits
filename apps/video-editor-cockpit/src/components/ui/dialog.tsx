import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

/**
 * A modal with the shadcn Dialog's API and none of its machinery.
 *
 * Radix would be four more dependencies for one dialog. What that dialog
 * actually has to do is short and worth doing properly: close on Escape and
 * on a click outside, trap focus so Tab cannot walk behind it, put focus
 * back where it came from, and tell a screen reader what it is.
 */
export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const cameFrom = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    cameFrom.current = document.activeElement;
    const focusables = () =>
      [
        ...(box.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ].filter(el => el.offsetParent !== null);

    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onOpenChange?.(false);
        return;
      }
      if (e.key !== "Tab") return;
      const all = focusables();
      if (!all.length) return;
      const first = all[0];
      const last = all[all.length - 1];
      const here = document.activeElement;
      if (e.shiftKey && (here === first || !box.current?.contains(here))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && here === last) {
        e.preventDefault();
        first.focus();
      }
    };

    // Capture, so the page's own single-key shortcuts do not fire behind it.
    window.addEventListener("keydown", onKey, true);
    const scroll = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = scroll;
      (cameFrom.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={() => onOpenChange?.(false)}
        className="absolute inset-0 cursor-default bg-black/50"
      />
      <div ref={box} className="relative w-full max-w-lg">
        {children}
      </div>
    </div>
  );
}

export function DialogContent({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className={`panel w-full p-5 shadow-2xl ${className}`}
    >
      {children}
    </div>
  );
}

export function DialogHeader({ children }: { children: ReactNode }) {
  return <div className="mb-3 space-y-1">{children}</div>;
}

export function DialogTitle({
  className = "",
  children,
  ...rest
}: {
  className?: string;
  children: ReactNode;
  dir?: string;
}) {
  return (
    <h2
      className={`text-base font-semibold tracking-tight ${className}`}
      {...rest}
    >
      {children}
    </h2>
  );
}

export function DialogDescription({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <p className={`muted text-sm ${className}`}>{children}</p>;
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 flex flex-wrap justify-end gap-2">{children}</div>
  );
}

/** Exported for completeness; the ideation page closes with its own buttons. */
export function DialogClose({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close"
      className="muted absolute right-3 top-3"
    >
      <X className="size-4" />
    </button>
  );
}
