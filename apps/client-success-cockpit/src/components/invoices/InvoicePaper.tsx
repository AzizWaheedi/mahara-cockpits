import { useLayoutEffect, useRef, useState } from "react";

/** An A4 page at 96 dpi: the size the template lays itself out for. */
const PAGE_W = 794;
const PAGE_H = 1123;

/**
 * The invoice itself, beside the form: the worker's template filled with what
 * is typed, scaled to the column. It is the page the client gets, not a
 * summary of it. The frame is sandboxed (no scripts) and ignores the pointer,
 * so the page scrolls as one.
 */
export function InvoicePaper({
  html,
  caption,
}: {
  html: string | null;
  caption: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // Measured now, so the page shows on the first frame; the observer follows resizes.
    setWidth(el.getBoundingClientRect().width);
    const watch = new ResizeObserver(entries => {
      setWidth(entries[0]?.contentRect.width ?? 0);
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const scale = width / PAGE_W;
  return (
    <figure className="rounded-2xl bg-muted/40 p-4 sm:p-6">
      <div
        ref={box}
        className="relative w-full overflow-hidden rounded-[3px] bg-white shadow-[0_12px_40px_rgba(10,22,51,0.14)] ring-1 ring-black/5"
        style={{ aspectRatio: `${PAGE_W} / ${PAGE_H}` }}
      >
        {html && width > 0 ? (
          <iframe
            title="Invoice preview"
            srcDoc={html}
            sandbox=""
            tabIndex={-1}
            className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
            style={{
              width: PAGE_W,
              height: PAGE_H,
              transform: `scale(${scale})`,
            }}
          />
        ) : null}
      </div>
      <figcaption className="mt-3 text-xs text-muted-foreground">
        {caption}
      </figcaption>
    </figure>
  );
}
