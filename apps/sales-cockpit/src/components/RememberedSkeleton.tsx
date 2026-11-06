import {
  type ComponentType,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  contentHeight,
  currentPageKey,
  LAYOUT_QUIET_MS,
  type LayoutItem,
  placeLayout,
  type RememberedLayout,
  readLayout,
  snapshotLayout,
  visibleItems,
  writeLayout,
} from "../lib/rememberedLayout";

type Offset = { x: number; y: number };

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number },
  ) => number;
};

function ReplayItem({ item, off }: { item: LayoutItem; off: Offset }) {
  const style = {
    position: "absolute" as const,
    left: item[1] - off.x,
    top: item[2] - off.y,
    width: item[3],
  };
  const height = item[4];

  if (item[0] === 0) {
    const [t, r, b, l] = item[8].split(" ").map(v => `${Number(v) || 0}px`);
    return (
      <div
        style={{
          ...style,
          height,
          background: item[6],
          borderColor: item[7],
          borderStyle: "solid",
          borderWidth: `${t} ${r} ${b} ${l}`,
          borderRadius: item[5],
        }}
      />
    );
  }

  if (item[0] === 1) {
    return (
      <div
        className="motion-safe:animate-pulse bg-muted"
        style={{ ...style, height, borderRadius: Math.max(item[5], 4) }}
      />
    );
  }

  if (item[0] === 2) {
    const lineHeight = Math.min(22, Math.max(6, Math.round(height * 0.6)));
    return (
      <div
        className="motion-safe:animate-pulse bg-muted"
        style={{
          ...style,
          top: style.top + (height - lineHeight) / 2,
          height: lineHeight,
          borderRadius: 4,
        }}
      />
    );
  }

  return (
    <div
      data-section={item[5]}
      style={{ ...style, height, pointerEvents: "none" }}
    />
  );
}

export function rememberedSkeleton<P extends object>(
  name: string,
  Static: ComponentType<P>,
  options?: { className?: string },
): ComponentType<P> {
  function Remembered(props: P) {
    const [layout] = useState<RememberedLayout | null>(() =>
      typeof window === "undefined" ? null : readLayout(currentPageKey()),
    );
    const [fallback, setFallback] = useState(!layout);
    const [offset, setOffset] = useState<Offset | null>(null);
    const ref = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
      if (!layout) {
        setFallback(true);
        return;
      }
      const root = ref.current;
      if (!root) {
        setFallback(true);
        return;
      }
      const main = root.closest("main");
      const mainRect = main ? main.getBoundingClientRect() : null;
      const rootRect = root.getBoundingClientRect();
      const placed = placeLayout(layout, {
        main: mainRect
          ? {
              left: mainRect.left,
              top: mainRect.top,
              width: mainRect.width,
            }
          : null,
        root: {
          left: rootRect.left,
          top: rootRect.top,
          width: rootRect.width,
        },
        vw: window.innerWidth,
        dark: document.documentElement.classList.contains("dark"),
      });
      if (!placed || contentHeight(layout, placed) === 0) {
        setFallback(true);
        return;
      }
      setOffset(placed);
    }, [layout]);

    if (fallback || !layout) return <Static {...props} />;

    const height = offset ? contentHeight(layout, offset) : layout.h;

    return (
      <div
        ref={ref}
        data-page-skeleton={name}
        data-remembered=""
        aria-hidden="true"
        className={options?.className}
        style={{ position: "relative", width: "100%", height }}
      >
        {offset
          ? visibleItems(layout, offset).map((item, index) => (
              <ReplayItem key={index} item={item} off={offset} />
            ))
          : null}
      </div>
    );
  }

  Remembered.displayName = `Remembered(${name})`;
  return Remembered;
}

export function LayoutRecorder({ pathname }: { pathname: string }) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!pathname) return;

    const path = currentPageKey();
    const started = Date.now();
    let cancelled = false;
    let saves = 0;
    let savedSig = "";
    let lastSig = "";
    let timer: ReturnType<typeof setInterval> | null = null;

    function stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    }

    function tick() {
      if (cancelled) return;
      if (
        currentPageKey() !== path ||
        saves >= 3 ||
        Date.now() - started > 30000
      ) {
        stop();
        return;
      }
      const main = document.querySelector<HTMLElement>("main");
      if (!main) {
        lastSig = "";
        return;
      }
      const sig = `${Math.round(main.getBoundingClientRect().height)}:${main.scrollHeight}:${main.getElementsByTagName("*").length}`;
      if (sig !== lastSig) {
        lastSig = sig;
        return;
      }
      if (sig === savedSig) return;
      if (main.querySelector("[data-page-skeleton]")) return;
      if (
        main.querySelector('[aria-busy="true"]') &&
        Date.now() - started < 15000
      )
        return;
      savedSig = sig;
      const run = () => {
        if (cancelled) return;
        try {
          const layout = snapshotLayout(main);
          if (layout) {
            writeLayout(path, layout);
            saves += 1;
          }
        } catch {
          // A failed snapshot never reaches React.
        }
      };
      if (typeof (window as IdleWindow).requestIdleCallback === "function") {
        (window as IdleWindow).requestIdleCallback?.(run, { timeout: 1000 });
      } else {
        setTimeout(run, 0);
      }
    }

    timer = setInterval(tick, LAYOUT_QUIET_MS);

    return () => {
      cancelled = true;
      stop();
    };
  }, [pathname]);

  return null;
}
