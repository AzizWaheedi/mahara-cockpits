import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * "Is this thing working?"
 *
 * A cockpit that silently goes stale is worse than no cockpit: she acts on
 * yesterday's numbers believing they are today's. [aziz, 2026-09-07]
 *
 * One callout, and only when something is wrong: the data has not refreshed
 * for five hours, or the last refresh reported problems. On a normal day the
 * page header's "synced 10:40" says it all, so nothing shows here. This is
 * also the one place for the older "these numbers are not today's" and "part
 * of this screen is missing" warnings, which used to repeat it in two more
 * boxes.
 */

function ago(t: number) {
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

const HOUR = 3600 * 1000;

export function ViktorStatus() {
  const a = useQuery(api.chat.activity, { limit: 6 });
  const jobs = useQuery(api.assist.queueDepth, {});
  if (!a) return null;

  const age = a.lastSyncAt
    ? Date.now() - a.lastSyncAt
    : Number.POSITIVE_INFINITY;
  const stale = age > 5 * HOUR;
  const notToday = a.lastSyncAt ? age > 20 * HOUR : false;
  const problems: string[] = a.problems ?? [];
  if (!stale && problems.length === 0 && a.lastSyncOk !== false) return null;

  const busy = [
    a.queued > 0
      ? `${a.queued} question${a.queued === 1 ? "" : "s"} to Aziz still sending`
      : "",
    jobs && jobs.working > 0
      ? `${jobs.working} job${jobs.working === 1 ? "" : "s"} running`
      : "",
    jobs && jobs.queued > 0 ? `${jobs.queued} queued` : "",
  ].filter(Boolean);

  return (
    <div role="status" className="callout-warn rounded-xl border p-3 sm:p-4">
      <p className="text-sm font-semibold">
        {!a.lastSyncAt
          ? "The data has never synced."
          : notToday
            ? `These numbers are from ${new Date(
                a.lastSyncAt,
              ).toLocaleDateString("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "short",
              })}, not today.`
            : stale
              ? `The data last refreshed ${ago(a.lastSyncAt)}.`
              : "The last refresh had problems."}
      </p>
      {notToday ? (
        <p className="mt-1 text-xs">
          The refresh has not run since. Don't change budgets off this screen
          until it has; ask with Report a problem instead.
        </p>
      ) : null}
      {problems.length > 0 ? (
        <>
          <p className="mt-1 text-xs">
            Part of this screen is not showing everything it should. Aziz is
            alerted; a blank section does not mean there is no work.
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            {problems.map(p => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </>
      ) : null}
      {busy.length ? (
        <p className="mt-1 text-xs opacity-80">{busy.join(" · ")}</p>
      ) : null}
    </div>
  );
}
