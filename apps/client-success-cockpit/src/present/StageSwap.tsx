import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useReducer,
  useRef,
} from "react";

/**
 * A stop's picture changing (DESIGN 5.3, 22.3): a real crossfade. The
 * incoming stage fades in over `--dk-t-stage` while the outgoing one stays
 * in the same grid cell and fades out at 75% of that on `--dk-ease-in`, so
 * the stage half of the slide is never blank between presses (on a Zoom
 * share a blank frame reads as a blink). Both are opacity only.
 *
 * Each stage is keyed by its stop, so the outgoing one is the same mounted
 * node (no remount, no replayed arrival): only its role changes. Under
 * `still` (the shots, reduced motion) the outgoing one is dropped at once.
 *
 * `sequential` is for two different layouts in one box (O7: what to expect,
 * the starter ads, the Blueprint): a crossfade there drew both layouts over
 * each other for about 300 ms, which reads as a rendering fault on a shared
 * screen. The outgoing stage fades out over half the stage time on the exit
 * curve, and only then does the incoming one fade in (its delay is that
 * half), so the two never overlap. The crossfade stays for swaps whose
 * layout holds (a phone's screen, the portal). DESIGN 22.11.
 */

/** The outgoing stage's fade, at 75% of the entrance (420 ms). */
const EXIT_MS = 315;
/** Sequential: the outgoing stage's fade, half the stage time (420 ms). */
const EXIT_SEQ_MS = 210;

export function StageSwap({
  at,
  className,
  still = false,
  sequential = false,
  style,
  children,
}: {
  /** The stop (or anything that names the stage): a change swaps it. */
  at: string | number;
  /** The stage's own class (its layout and its entrance animation). */
  className?: string;
  still?: boolean;
  /** Out, then in, never both at once: for two different layouts. */
  sequential?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const cur = useRef<{ at: string | number; node: ReactNode }>({
    at,
    node: children,
  });
  const out = useRef<{ at: string | number; node: ReactNode } | null>(null);
  // The stage that came in after an outgoing one waits for it to leave
  // (sequential): it keeps that delay for as long as it is the stage, so
  // dropping the outgoing one never restarts its entrance.
  const after = useRef<string | number | null>(null);
  if (cur.current.at !== at) {
    out.current = still ? null : cur.current;
    after.current = still ? null : at;
  }
  cur.current = { at, node: children };
  const [, drop] = useReducer((n: number) => n + 1, 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new stop starts the outgoing one's clock
  useEffect(() => {
    if (!out.current) return;
    const id = window.setTimeout(
      () => {
        out.current = null;
        drop();
      },
      sequential ? EXIT_SEQ_MS : EXIT_MS,
    );
    return () => window.clearTimeout(id);
  }, [at]);
  const leaving = out.current && out.current.at !== at ? out.current : null;
  return (
    <div
      className="dk-swap"
      data-mode={sequential ? "seq" : undefined}
      style={style}
    >
      {leaving ? (
        <div
          key={String(leaving.at)}
          className={`${className ?? ""} dk-swap-out`}
          data-swap="out"
          aria-hidden
        >
          {leaving.node}
        </div>
      ) : null}
      <div
        key={String(at)}
        className={className}
        data-swap="in"
        data-after={sequential && after.current === at ? "" : undefined}
      >
        {children}
      </div>
    </div>
  );
}
