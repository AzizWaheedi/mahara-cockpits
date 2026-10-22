import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/** An A4 page at 96 dpi: the size the template lays itself out for. */
const PAGE_W = 794;
const PAGE_H = 1123;

const headOf = (html: string) => html.slice(0, html.indexOf("</head>"));

/**
 * Make `from` match `to`, touching only what differs, so the nodes that did
 * not change (the logo, the fonts already drawn) stay as they are.
 */
function morph(from: Node, to: Node): void {
  if (from.nodeType !== Node.ELEMENT_NODE) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  const a = from as Element;
  const b = to as Element;
  for (const name of a.getAttributeNames()) {
    if (!b.hasAttribute(name)) a.removeAttribute(name);
  }
  for (const name of b.getAttributeNames()) {
    const value = b.getAttribute(name) ?? "";
    if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  }
  const doc = a.ownerDocument;
  const want = Array.from(b.childNodes);
  want.forEach((next, i) => {
    const have = a.childNodes[i];
    if (!have) a.appendChild(doc.importNode(next, true));
    else if (have.nodeType === next.nodeType && have.nodeName === next.nodeName)
      morph(have, next);
    else a.replaceChild(doc.importNode(next, true), have);
  });
  while (a.childNodes.length > want.length) a.lastChild?.remove();
}

/**
 * The invoice itself, beside the form: the worker's template filled with what
 * is typed, scaled to the column. It is the page the client gets, not a
 * summary of it. The frame loads the page once; after that each change is
 * written into the page in place, so it never reloads or flashes while a
 * person types. The frame runs no scripts and ignores the pointer, so the
 * page scrolls as one.
 */
export function InvoicePaper({
  html,
  caption,
}: {
  html: string | null;
  caption: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(html);
  const [width, setWidth] = useState(0);
  // The page the frame was loaded with; replaced only when the head changes.
  const [loaded, setLoaded] = useState<string | null>(null);

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

  // Write the newest page into the frame. Before the frame has loaded, its
  // load event calls this again.
  const sync = useCallback(() => {
    const next = latest.current;
    const doc = frame.current?.contentDocument;
    if (!next || !loaded || !doc?.body || doc.readyState !== "complete") return;
    if (headOf(next) !== headOf(loaded)) {
      setLoaded(next);
      return;
    }
    const body = new DOMParser().parseFromString(next, "text/html").body;
    morph(doc.body, body);
  }, [loaded]);

  useEffect(() => {
    latest.current = html;
    if (html && !loaded) setLoaded(html);
    else sync();
  }, [html, loaded, sync]);

  const scale = width / PAGE_W;
  return (
    <figure className="rounded-2xl bg-muted/40 p-4 sm:p-6">
      <div
        ref={box}
        className="relative w-full overflow-hidden rounded-[3px] bg-white shadow-[0_12px_40px_rgba(10,22,51,0.14)] ring-1 ring-black/5"
        style={{ aspectRatio: `${PAGE_W} / ${PAGE_H}` }}
      >
        {loaded && width > 0 ? (
          <iframe
            ref={frame}
            title="Invoice preview"
            srcDoc={loaded}
            // Same origin only so the page can be written in place; scripts stay off.
            sandbox="allow-same-origin"
            tabIndex={-1}
            onLoad={sync}
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
