import { useEffect, useRef, useState } from "react";
import type { Timeframe } from "./timeframe";

/**
 * A section whose window is computed on the server, for any run of days.
 *
 * Most tabs rebuild a timeframe from their daily series on the screen. Two
 * cannot: the ads tree is thousands of ad-days and the content split is a
 * classification, so the same query runs again on the backend for exactly the
 * days asked for (`ceo.windows`). The stored payload answers the preset it
 * was computed for, so the common case costs nothing and the screen only
 * waits when it is asked something new.
 */
export function useServerWindow<T>({
  tf,
  first,
  last,
  stored,
  read,
}: {
  tf: Timeframe;
  /** The oldest and newest day the section has, for the date pickers. */
  first: string | null;
  last: string | null;
  /** The window the stored payload already holds for these bounds, if any. */
  stored: (b: { from: string; to: string }) => T | null;
  read: (b: { from: string; to: string }) => Promise<T>;
}): {
  data: T | null;
  bounds: { from: string; to: string } | null;
  loading: boolean;
  error: string | null;
  /** True when the numbers were read live rather than from the stored payload. */
  live: boolean;
} {
  const bounds = last ? tf.bounds(last, first) : null;
  const key = bounds ? `${bounds.from}..${bounds.to}` : "";
  const fromStore = bounds ? stored(bounds) : null;

  const [state, setState] = useState<{
    key: string;
    data: T | null;
    error: string | null;
  }>({ key: "", data: null, error: null });
  const [loading, setLoading] = useState(false);
  // The action is recreated on every render by useAction, so it must not be a
  // dependency or the effect would run forever.
  const readRef = useRef(read);
  readRef.current = read;

  useEffect(() => {
    if (!key || fromStore) return;
    let alive = true;
    const [from, to] = key.split("..");
    setLoading(true);
    readRef
      .current({ from, to })
      .then(data => {
        if (alive) setState({ key, data, error: null });
      })
      .catch(e => {
        if (alive)
          setState({
            key,
            data: null,
            error: String(e instanceof Error ? e.message : e).slice(0, 300),
          });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [key, fromStore]);

  if (fromStore)
    return {
      data: fromStore,
      bounds,
      loading: false,
      error: null,
      live: false,
    };
  const fresh = state.key === key;
  return {
    data: fresh ? state.data : null,
    bounds,
    loading: loading || (!fresh && Boolean(key)),
    error: fresh ? state.error : null,
    live: true,
  };
}
