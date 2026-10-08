import { isStale, newestPublish } from "@/lib/freshness";

type Source = Parameters<typeof newestPublish>[0];

/**
 * Sync health strip. Silent when everything is fresh, loud when it is not, so
 * you never work off a board that quietly stopped updating. [aziz, 2026-09-07]
 * Reads the newest table publish from the creative source read (8 Oct 2026).
 */
export function SyncHealth({
  source,
  now = Date.now(),
}: {
  source: Source;
  now?: number;
}) {
  if (source === undefined) return null;
  const at = newestPublish(source);
  if (!isStale(at, now)) return null;
  const when =
    at !== null
      ? new Date(at).toLocaleTimeString("en-GB", {
          timeZone: "Asia/Kuwait",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {when !== null && at !== null
        ? `The creative feed last refreshed at ${when} Kuwait time (${Math.round((now - at) / 60000)} min ago). Check the source before using these figures.`
        : "No creative refresh has been recorded yet. Check the source before using these figures."}
    </p>
  );
}
