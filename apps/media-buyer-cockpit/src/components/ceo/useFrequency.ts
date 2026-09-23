import { useAction } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { FrequencyRead } from "../../../convex/ceo/frequency";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reach and frequency for a window, read through ceo/frequency:forRange as
 * the window changes. The server keeps each window's figure for three
 * hours, so flicking between presets costs one Meta call per new window.
 * A half-typed custom date is ignored until both days are real.
 */
export function useFrequency(from: string | null, to: string | null) {
  const forRange = useAction(api.ceo.frequency.forRange);
  const [read, setRead] = useState<FrequencyRead | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef("");

  useEffect(() => {
    if (!from || !to || !DAY.test(from) || !DAY.test(to) || from > to) return;
    const key = `${from}..${to}`;
    latest.current = key;
    // A typed date changes every keystroke; wait for the reader to finish.
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      forRange({ from, to })
        .then(r => {
          if (latest.current === key) setRead(r);
        })
        .catch(e => {
          if (latest.current === key)
            setError(String(e instanceof Error ? e.message : e).slice(0, 200));
        })
        .finally(() => {
          if (latest.current === key) setLoading(false);
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [from, to, forRange]);

  return { read, loading, error };
}
