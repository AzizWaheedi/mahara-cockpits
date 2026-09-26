import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

/** Minutes after which a feed counts as stale during Kuwait working hours. */
const STALE_MINUTES = 50;

/**
 * One honest line about the data underneath every screen. Green path: nothing shows.
 * If the last bridge run failed, or nothing has landed for the best part of an hour,
 * the CSM sees it here instead of trusting stale numbers.
 */
export function SyncStrip() {
  const s = useQuery(api.csm.syncStatus, {});
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
