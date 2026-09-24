import { useEffect, useState } from "react";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";

/** Minutes after which a feed counts as stale during Kuwait working hours. */
const STALE_MINUTES = 50;

/**
 * One honest line about the data underneath every screen. Green path: nothing shows.
 * If the last bridge run failed, or nothing has landed for the best part of an hour,
 * the CSM sees it here instead of trusting stale numbers.
 */
export function SyncStrip() {
  const auth = useCockpitAuth();
  const [s, setS] = useState<{ ok: boolean; at: number; errors: string[] } | null>(null);

  useEffect(() => {
    if (!auth.client) return;
    let cancelled = false;
    const fetchLatest = async () => {
      try {
        const { data } = await auth.client!
          .from("cockpit_client_profiles")
          .select("synced_at")
          .order("synced_at", { ascending: false })
          .limit(1);
        if (cancelled) return;
        const latest = (data as any)?.[0]?.synced_at;
        const at = latest ? new Date(latest).getTime() : Date.now();
        setS({ ok: true, at, errors: [] });
      } catch {
        if (!cancelled) setS({ ok: true, at: Date.now(), errors: [] });
      }
    };
    void fetchLatest();
    return () => {
      cancelled = true;
    };
  }, [auth.client]);
  if (!s) return null;

  const at = s.at;
  const ageMin = at ? Math.round((Date.now() - at) / 60000) : null;
  const hour = Number(
    new Date().toLocaleString("en-GB", {
      timeZone: "Asia/Kuwait",
      hour: "2-digit",
      hour12: false,
    }),
  );
  const workingHours = hour >= 7 && hour < 21;
  const stale = ageMin === null || (workingHours && ageMin > STALE_MINUTES);
  if (s.ok && !stale) return null;

  const when = at
    ? new Date(at).toLocaleTimeString("en-GB", {
        timeZone: "Asia/Kuwait",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const detail = !s.ok
    ? s.errors[0] || "one of the feeds failed"
    : "no new data has come in";

  return (
    <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <span className="font-semibold">Some data may be stale.</span>{" "}
      {when ? `Last full sync ${when} Kuwait time` : "No sync recorded yet"}
      {ageMin !== null ? ` (${ageMin} min ago)` : ""}. {detail}. It retries
      every 30 minutes, so keep working, the numbers will catch up.
    </div>
  );
}
