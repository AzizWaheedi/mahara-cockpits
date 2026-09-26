import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

/**
 * A panel over the page, the way the other cockpits open a preview.
 *
 * An ad is a nine-by-sixteen video and a card column is the wrong shape for
 * it. Escape closes, the backdrop closes, focus moves in and comes back to
 * where it was, and the page behind does not scroll while it is open.
 */
export default function Lightbox({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Element | null>(null);

  useEffect(() => {
    returnTo.current = document.activeElement;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const wasOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = wasOverflow;
      (returnTo.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  return (
    // Clear of the status bar and the home bar in the installed app, so the
    // title and the close button are never under the clock.
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div
        ref={panel}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the panel takes focus when it opens
        tabIndex={0}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl border bg-card"
      >
        <header className="flex items-center gap-2 border-b py-1 pr-1 pl-4">
          <h2
            dir="auto"
            className="min-w-0 flex-1 truncate text-sm font-medium"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X aria-hidden className="size-4" strokeWidth={2} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
