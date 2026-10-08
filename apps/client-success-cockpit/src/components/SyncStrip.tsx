import { useEffect, useState } from "react";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { readCsmSources } from "@/lib/csmReadModel";
import { newestPublish } from "@/lib/freshness";

/** Minutes after which a feed counts as stale during Kuwait working hours. */
const STALE_MINUTES = 50;

/**
 * One honest line about the data underneath every screen. Green path: nothing shows.
 * If the last bridge run failed, or nothing has landed for the best part of an hour,
 * the CSM sees it here instead of trusting stale numbers.
 *
 * `only="stale"` is the every-page copy: it shows only when the sync itself has
 * stopped. One feed failing (one client's sheet not shared, say) is `only="feed"`,
 * shown on Today alone, because a red line on every page for one client teaches
 * people to stop reading it (the simplification audit, 2026-10-06).
 */
export function SyncStrip({ only }: { only?: "stale" | "feed" } = {}) {
  const auth = useCockpitAuth();
  const [s, setS] = useState<{
    ok: boolean;
    at: number;
    errors: string[];
  } | null>(null);

  useEffect(() => {
    if (!auth.client) return;
    let cancelled = false;
    const fetchLatest = async () => {
      try {
        const { tables, source } = await readCsmSources(auth.client!);
        if (cancelled) return;
        const runs = [...tables.syncRuns].sort((a, b) => b.at - a.at);
        const health = runs.find(run => run.kind === "health");
        const feed = runs.find(
          run => run.role === "csm" && run.kind !== "health",
        );
        const legacyAt = health?.at ?? feed?.at ?? 0;
        // The native worker publishes the live tables and writes no syncRuns row.
        const published = newestPublish(source);
        setS(
          published !== null && published > legacyAt
            ? { ok: true, at: published, errors: [] }
            : {
                ok: health?.ok ?? true,
                at: legacyAt,
                errors: health?.errors ?? [],
              },
        );
      } catch (error) {
        if (!cancelled)
          setS({
            ok: false,
            at: 0,
            errors: [
              error instanceof Error
                ? error.message
                : "The sync status could not be read. Reload the page.",
            ],
          });
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
  if (only === "stale" && !stale) return null;
  if (only === "feed" && stale) return null;

  const when = at
    ? new Date(at).toLocaleTimeString("en-GB", {
        timeZone: "Asia/Kuwait",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  // A plain reason on the strip; the feed's own error is folded under it.
  const age = ageMin !== null ? ` (${ageMin} min ago)` : "";
  const sentence = when
    ? `The last full sync was at ${when} Kuwait time${age}, and ${!s.ok ? "one of the data feeds did not answer" : "nothing new has come in since"}.`
    : `No sync has been recorded yet${!s.ok ? ", and one of the data feeds did not answer" : ""}.`;
  const raw = !s.ok ? s.errors[0] : undefined;

  return (
    <div className="callout-warn mx-auto mb-6 w-full max-w-6xl rounded-2xl border px-4 py-3 text-sm">
      <p>
        <span className="font-semibold">Some numbers may be out of date.</span>{" "}
        {sentence} It retries every 30 minutes, so keep working; the numbers
        will catch up.
      </p>
      {raw ? (
        <details className="mt-1 text-xs opacity-90">
          <summary>What the feed said</summary>
          <p className="mt-1 break-words font-mono">{raw}</p>
        </details>
      ) : null}
    </div>
  );
}
