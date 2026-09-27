import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

/** One quiet line when the phone has no connection; the shell still opens, the numbers wait. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" && navigator.onLine === false,
  );
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
  if (!offline) return null;
  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs text-muted-foreground"
    >
      <WifiOff className="size-3.5 shrink-0" aria-hidden />
      You are offline. The numbers refresh the moment the connection is back.
    </div>
  );
}
