import { CloudOff, WifiOff } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useReadsStale } from "@/lib/readHealth";

/**
 * One quiet line when the phone has no connection, or when a refresh failed
 * and the screen is showing the last numbers that loaded (a database restart
 * on 2026-10-13 used to take the whole Ads screen down instead).
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" && navigator.onLine === false,
  );
  const stale = useReadsStale();
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  if (offline)
    return (
      <Line icon={<WifiOff className="size-3.5 shrink-0" aria-hidden />}>
        You are offline. The numbers refresh the moment the connection is back.
      </Line>
    );
  if (stale)
    return (
      <Line icon={<CloudOff className="size-3.5 shrink-0" aria-hidden />}>
        The numbers could not refresh just now. You are seeing the last ones
        that loaded, and the cockpit keeps trying.
      </Line>
    );
  return null;
}

function Line({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs text-muted-foreground"
    >
      {icon}
      {children}
    </div>
  );
}
