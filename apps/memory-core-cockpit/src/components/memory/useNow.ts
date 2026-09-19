import { useEffect, useState } from "react";

/**
 * A clock that ticks every 30 seconds, so "3 min ago" and the stale warning
 * change while the screen is open instead of freezing at load time.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
