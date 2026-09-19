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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
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
        className="panel relative flex max-h-full w-full max-w-lg flex-col overflow-hidden"
      >
        <header className="flex items-center gap-3 border-b hairline px-4 py-2.5">
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="muted"
          >
            <X className="size-4" strokeWidth={2} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
